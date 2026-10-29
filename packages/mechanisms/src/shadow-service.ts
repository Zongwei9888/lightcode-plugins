/**
 * LightShadow for any host, in three calls. The host adapter only translates:
 * it hands over the span being compacted as `ShadowMessage`s and, depending on
 * what the host lets a plugin do, gets back
 *
 * - `shadowCheckpoint` (full tier): the host's summarizer already condensed
 *   the span with `SHADOW_SUMMARY_INSTRUCTION`; the checkpoint text (summary,
 *   the user's exact messages, the catalog) replaces that summary.
 * - `shadowCatalog` (assisted tier): the host writes its own summary and
 *   lets a plugin add context after it; the catalog goes there.
 * - `recallFromJournal`: the recall tool, wherever it runs (in process, `lc
 *   recall`, the `lc mcp` server).
 *
 * Every function journals what it did and throws nothing a host must handle
 * beyond its own fail-open path.
 */
import type { ArtifactPort, EconomyRecord, JournalPort, JournalRecord, ShadowRecallRecord, ShadowReference } from '@lightcode-ai/protocol'
import {
  callLabel, checkpointAdmitted, checkpointRecord, fitCheckpoint, planShadow, recallIndex, recallObservation, referenceIndex, renderCatalog, renderCheckpoint, renderRecall,
} from './shadow.ts'
import type { RecallArguments, ShadowMessage, ShadowPlan } from './shadow.ts'

export interface ShadowStore {
  readonly journal: JournalPort
  readonly artifacts: ArtifactPort
  /** This session's journal records (checkpoints and Economy decisions). */
  readonly read: (sessionId: string) => readonly JournalRecord[]
  readonly now?: () => Date
}

/** The span a host is about to compact. */
export interface ShadowSpan {
  readonly host: string
  readonly sessionId: string | null
  readonly messages: readonly ShadowMessage[]
  /** The previous checkpoint, when the host passes it apart from the span (pi does). */
  readonly prior?: string
}

const ROLES = new Set(['user', 'assistant', 'tool', 'summary', 'other'])

/**
 * Messages from untyped input (JSON from a hook or another language). Anything
 * unrecognized becomes `other`, so it is summarized but never externalized.
 */
export function shadowMessagesFrom(value: unknown): ShadowMessage[] {
  if (!Array.isArray(value)) return []
  const out: ShadowMessage[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const fields = item as Record<string, unknown>
    if (typeof fields.text !== 'string') continue
    const role = typeof fields.role === 'string' && ROLES.has(fields.role) ? fields.role as ShadowMessage['role'] : 'other'
    const text = (key: string) => typeof fields[key] === 'string' && fields[key] !== '' ? fields[key] as string : undefined
    const toolName = text('toolName') ?? text('tool_name'), callId = text('callId') ?? text('call_id')
    // `call_input`: the call's raw arguments, labeled here so adapters need not.
    const call = text('call') ?? (fields.call_input !== undefined ? callLabel(fields.call_input) : undefined)
    out.push({ role, text: fields.text, ...toolName ? { toolName } : {}, ...callId ? { callId } : {}, ...call ? { call } : {} })
  }
  return out
}

/** What earlier checkpoints of the session listed, and the originals Economy shortened, by call ID. */
function sessionLookups(span: ShadowSpan, store: ShadowStore) {
  const records = span.sessionId ? store.read(span.sessionId) : []
  const known = referenceIndex(records)
  const originals = new Map<string, { sha256: string; bytes: number }>()
  for (const record of records) {
    const economy = record as EconomyRecord
    if (economy.type === 'economy/decision' && economy.outcome === 'projected' && economy.callId && economy.raw?.stored) {
      originals.set(economy.callId, { sha256: economy.raw.sha256, bytes: economy.raw.bytes })
    }
  }
  return { known, originals }
}

function plan(span: ShadowSpan, store: ShadowStore): { plan: ShadowPlan; known: Map<string, ShadowReference> } {
  const { known, originals } = sessionLookups(span, store)
  const planned = planShadow(span.messages, {
    artifacts: store.artifacts, knownReference: id => known.get(id), originalOf: id => originals.get(id),
    ...span.prior === undefined ? {} : { prior: span.prior },
  })
  return { plan: planned, known }
}

const time = (store: ShadowStore) => (store.now?.() ?? new Date()).toISOString()

function record(store: ShadowStore, value: JournalRecord): void {
  try { store.journal.append(value) } catch { /* The checkpoint still works; only its record is lost. */ }
}

export interface CheckpointResult {
  /** The text that replaces the host's summary; undefined when the host's own summary should stay. */
  readonly text: string | undefined
  readonly references: number
  /** Each reference's ID and the call it came from, so the host can mark results it shortened elsewhere. */
  readonly list: readonly { readonly id: string; readonly callId: string | null }[]
}

/**
 * Full tier. `summary` is what the host's summarizer wrote for the span (asked
 * with `SHADOW_SUMMARY_INSTRUCTION`). A checkpoint that is not smaller than
 * the span is not used.
 */
export function shadowCheckpoint(span: ShadowSpan & { readonly summary: string
  /** False when the host's summary already carries the user's messages word for word (Hermes). */
  readonly userMessages?: boolean }, store: ShadowStore): CheckpointResult {
  const base = { host: span.host, sessionId: span.sessionId, time: time(store) }
  const { plan: full } = plan(span, store)
  const planned = span.userMessages === false ? { ...full, contract: [], contractOmitted: 0 } : full
  const text = fitCheckpoint(span.summary, planned, candidate => checkpointAdmitted(candidate, planned))
  if (text === undefined) {
    const compact = renderCheckpoint(span.summary, planned, { excerpts: 0 })
    record(store, checkpointRecord(base, { kind: 'standard', plan: planned, checkpointTokens: Math.ceil(compact.length / 4), reason: 'checkpoint-not-smaller' }))
    return { text: undefined, references: 0, list: [] }
  }
  record(store, checkpointRecord(base, { kind: 'lightshadow', plan: planned, checkpointTokens: Math.ceil(text.length / 4) }))
  return { text, references: planned.references.length, list: planned.references.map(reference => ({ id: reference.id, callId: reference.callId })) }
}

export interface CatalogResult {
  /** The catalog to put into the context after the host's compaction; empty when nothing is recallable. */
  readonly text: string
  /** References listed (this span's and the session's earlier ones that fit). */
  readonly references: number
  /** References this span added. */
  readonly added: number
}

/** Opening line of an assisted catalog, naming the tool as the host shows it to the model. */
export function catalogLead(toolName: string): string {
  return `LightCode kept the tool results that context compaction removed from this conversation. `
    + `Read any of them again, exactly as first seen, with the ${toolName} tool and its observation_id instead of re-running the command or re-reading the file.`
}

/**
 * Assisted tier. Saves the span's tool results and returns the catalog of
 * every reference the session has, newest kept within `budgetTokens`, to place
 * after the host's own summary. Earlier catalogs are listed again, so a model
 * that went through several compactions still sees all it can recall.
 */
export function shadowCatalog(span: ShadowSpan & { readonly toolName?: string; readonly lead?: string; readonly budgetTokens?: number }, store: ShadowStore): CatalogResult {
  const base = { host: span.host, sessionId: span.sessionId, time: time(store) }
  const { plan: planned, known } = plan(span, store)
  const merged = new Map(known)
  for (const reference of planned.references) { merged.delete(reference.id); merged.set(reference.id, reference) }
  const added = planned.references.filter(reference => !known.has(reference.id)).length
  const catalog = renderCatalog([...merged.values()], { budgetTokens: span.budgetTokens ?? 8_000 })
  const text = catalog.text ? `${span.lead ?? catalogLead(span.toolName ?? 'lightcode_recall')}\n\n${catalog.text}` : ''
  record(store, checkpointRecord(base, { kind: 'assisted', plan: planned, checkpointTokens: Math.ceil(text.length / 4) }))
  return { text, references: catalog.references.length, added }
}

/**
 * The recall tool over the journal. With a session, its checkpoints are
 * searched first; `anywhere` also finds references in other sessions (the
 * MCP server does not learn which session it serves; IDs are content hashes,
 * so a hit is the same text).
 */
export function recallFromJournal(args: RecallArguments, options: {
  readonly host: string
  readonly sessionId: string | null
  readonly callId?: string | null
  readonly artifacts: ArtifactPort
  readonly read: (sessionId: string) => readonly JournalRecord[]
  readonly readAll?: () => readonly JournalRecord[]
  readonly journal?: JournalPort
  readonly now?: () => Date
}): { ok: boolean; text: string } {
  const session = options.sessionId ? recallIndex(options.read(options.sessionId)) : new Map<string, ShadowReference>()
  let everywhere: Map<string, ShadowReference> | undefined
  const lookup = (id: string) => session.get(id) ?? (options.readAll ? (everywhere ??= recallIndex(options.readAll())).get(id) : undefined)
  const result = recallObservation(args, { lookup, artifacts: options.artifacts })
  const id = typeof args.observation_id === 'string' ? args.observation_id.trim() : ''
  const text = renderRecall(id, result)
  if (options.journal) {
    const entry: ShadowRecallRecord = {
      schemaVersion: 1, type: 'shadow/recall', time: (options.now?.() ?? new Date()).toISOString(), host: options.host, sessionId: options.sessionId,
      callId: options.callId ?? null, id, original: args.original === true || args.original === 'true',
      outcome: !result.ok ? 'failed' : result.complete ? 'returned' : 'window', bytes: Buffer.byteLength(text),
    }
    try { options.journal.append(entry) } catch { /* The answer matters more than its record. */ }
  }
  return { ok: result.ok, text }
}

/** The recall tool's parameters as JSON Schema, for hosts that declare tools that way (MCP, OpenAI-style function tools). */
export const RECALL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    observation_id: { type: 'string', description: 'An observation_id from the observation catalog, such as o-1a2b3c4d5e6f.' },
    query: { type: 'string', description: 'An exact string the result contains; for results over 8 KB, this or line.' },
    line: { type: 'integer', minimum: 1, description: 'A 1-based line number to read around; for results over 8 KB, this or query.' },
    original: { type: 'boolean', description: 'Read the complete output LightCode shortened before you first read it.' },
  },
  required: ['observation_id'],
  additionalProperties: false,
} as const
