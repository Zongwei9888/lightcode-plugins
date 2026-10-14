import { estimateTokens as defaultEstimate } from '@lightcode/core'
import type { TokenEstimator } from '@lightcode/core'
import type { ArtifactPort, ShadowCheckpointRecord, ShadowReference } from '@lightcode/protocol'

/**
 * LightShadow: recoverable history compaction. When the host compacts an
 * older segment of the conversation, tool results in it are saved privately
 * and replaced by references with a short excerpt; the host's summarizer then
 * condenses only what is left, the user's own messages are kept word for
 * word, and the checkpoint lists the references so the model can read any of
 * them again with the `recall` tool. A checkpoint that is not smaller than the
 * segment is not used: the host's standard compaction runs instead.
 */

/** One message of the segment being compacted, as the model read it. */
export interface ShadowMessage {
  readonly role: 'user' | 'assistant' | 'tool' | 'summary' | 'other'
  readonly text: string
  /** Tool results: the tool's name and call ID. */
  readonly toolName?: string
  readonly callId?: string
}

export interface ShadowOptions {
  readonly artifacts: ArtifactPort
  readonly estimateTokens?: TokenEstimator
  /** Excerpt kept in place of each externalized result. */
  readonly excerptBytes?: number
  /** A result is externalized only if that saves at least this many tokens. */
  readonly minimumSavedTokens?: number
  /** At most this many references per checkpoint, newest kept. */
  readonly maxReferences?: number
  /** Bound on the exact user messages carried in the checkpoint. */
  readonly maxContractBytes?: number
  /** References of earlier checkpoints, by ID, to carry forward when their catalog is in the segment. */
  readonly knownReference?: (id: string) => ShadowReference | undefined
  /** The previous checkpoint's text, when the host passes it apart from the segment (pi). */
  readonly prior?: string
  /** The original of a result Economy projected, by tool call ID. */
  readonly originalOf?: (callId: string) => { readonly sha256: string; readonly bytes: number } | undefined
}

export interface ShadowPlan {
  /** The segment with externalized results replaced by reference markers: the summarizer's input. */
  readonly residual: readonly ShadowMessage[]
  readonly references: readonly ShadowReference[]
  /** The user's messages, word for word, oldest first. */
  readonly contract: readonly string[]
  /** User messages left out of the contract by `maxContractBytes` (still in the residual). */
  readonly contractOmitted: number
  readonly segmentTokens: number
  /** The summary part of `options.prior`, without its user messages and catalog (they are carried here). */
  readonly residualPrior?: string
}

export const SHADOW_EXCERPT_BYTES = 320
export const SHADOW_RECALL_WINDOW_BYTES = 8192
export const RECALL_TOOL_NAME = 'lightcode_recall'

/** Appended to the host's own compaction instruction for the residual segment. */
export const SHADOW_SUMMARY_INSTRUCTION = [
  'After this compaction every tool result in this span stays recoverable: LightCode appends a catalog of them,',
  'and the agent can read any of them again with the recall tool. So write the summary the agent needs to carry on',
  'without re-running anything: the findings from the tool results (facts, file paths with line numbers, values,',
  'errors, what passed and what failed) and the decisions made. Do not paste whole files, logs or test output;',
  'say what they showed. Do not list observation IDs. The user\'s messages are kept word for word after the summary.',
].join(' ')

export const RECALL_TOOL_DESCRIPTION = 'Read again a tool result that context compaction removed, exactly as you first saw it. '
  + 'Its observation_id is listed in the observation catalog of the compacted summary. Results larger than 8 KB need a query: '
  + 'an exact string they contain (a symbol, path or error message); you get the lines around its first match. '
  + 'Set original to true for the complete output LightCode shortened before you first read it, when the catalog marks one.'

const CATALOG_OPEN = '<lightcode-observation-catalog>'
const CATALOG_CLOSE = '</lightcode-observation-catalog>'
const CATALOG_ID = /^observation_id: (o-[a-f0-9]{12})\b/gmu
const bytes = (text: string) => Buffer.byteLength(text, 'utf8')

/** The ID of a stored result: derived from its content, so the same text always has the same ID. */
export const referenceId = (hash: string) => `o-${hash.slice(0, 12)}`

/** First two and last two non-empty lines, at most `maxBytes` UTF-8 bytes. */
export function boundedExcerpt(text: string, maxBytes = SHADOW_EXCERPT_BYTES): string {
  const lines = text.split(/\r?\n/u).map(line => line.trim()).filter(Boolean)
  const picked = [...lines.slice(0, 2), ...lines.slice(-2)]
  const unique = picked.filter((line, i) => picked.indexOf(line) === i).join('\n')
  if (bytes(unique) <= maxBytes) return unique
  const half = Math.floor((maxBytes - 3) / 2)
  const points = [...unique]
  return `${fit(points, half).join('')}...${fit(points.toReversed(), half).toReversed().join('')}`
}

function fit(points: readonly string[], maxBytes: number): string[] {
  const out: string[] = []
  let size = 0
  for (const point of points) {
    size += bytes(point)
    if (size > maxBytes) break
    out.push(point)
  }
  return out
}

function marker(reference: ShadowReference): string {
  return ['[recoverable observation]', `observation_id: ${reference.id}`, `tool: ${reference.tool}`, `bytes: ${reference.bytes}`,
    reference.excerpt ? `excerpt:\n${reference.excerpt}` : ''].filter(Boolean).join('\n')
}

/** IDs in the observation catalogs of earlier checkpoints quoted in `text`. */
export function catalogIds(text: string): string[] {
  // LightShadow appends its catalog last; quoted text never contains the tag (see `quote`).
  const start = text.lastIndexOf(CATALOG_OPEN)
  if (start < 0) return []
  const end = text.indexOf(CATALOG_CLOSE, start)
  return [...text.slice(start, end < 0 ? undefined : end).matchAll(CATALOG_ID)].map(match => match[1]!)
}

/** JSON string literal on one line that cannot contain a tag: `<`, U+2028 and U+2029 are escaped. */
function quote(text: string): string {
  return JSON.stringify(text).replace(/</gu, '\\u003c').replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029')
}

/**
 * Externalize: save each tool result of the segment and replace it by a
 * reference when the marker is smaller; carry references whose catalog an
 * earlier checkpoint in the segment lists; collect the user's messages.
 */
export function planShadow(segment: readonly ShadowMessage[], options: ShadowOptions): ShadowPlan {
  const estimate = options.estimateTokens ?? defaultEstimate
  const minimumSaved = Math.max(1, options.minimumSavedTokens ?? 16)
  const maxReferences = options.maxReferences ?? 200
  const byId = new Map<string, ShadowReference>()
  const residual: ShadowMessage[] = []
  const users: string[] = []
  let segmentTokens = 0
  const carry = (text: string) => {
    const earlier = parseCheckpoint(text)
    for (const id of earlier.ids) {
      const known = options.knownReference?.(id)
      if (known) byId.set(id, known)
    }
    users.push(...earlier.contract)
    return earlier.summary
  }
  let residualPrior: string | undefined
  if (options.prior !== undefined) {
    // The checkpoint replaces the previous one too.
    segmentTokens += estimate(options.prior)
    residualPrior = carry(options.prior)
  }
  for (const message of segment) {
    segmentTokens += estimate(message.text)
    if (message.role === 'summary') {
      residual.push({ ...message, text: carry(message.text) })
      continue
    }
    if (message.role === 'user') users.push(message.text)
    if (message.role === 'tool' && message.text !== '') {
      const ref = options.artifacts.save(message.text)
      // The stored text must read back as what the model read; otherwise the result stays in place.
      if (options.artifacts.read(ref.sha256) === message.text) {
        const original = message.callId ? options.originalOf?.(message.callId) : undefined
        const reference: ShadowReference = {
          id: referenceId(ref.sha256), sha256: ref.sha256, bytes: ref.bytes, tool: message.toolName ?? 'tool', callId: message.callId ?? null,
          excerpt: boundedExcerpt(message.text, options.excerptBytes),
          ...original && original.sha256 !== ref.sha256 ? { original } : {},
        }
        const replacement = marker(reference)
        if (bytes(replacement) < ref.bytes && estimate(message.text) - estimate(replacement) >= minimumSaved) {
          byId.delete(reference.id)
          byId.set(reference.id, reference)
          residual.push({ ...message, text: replacement })
          continue
        }
      }
    }
    residual.push(message)
  }
  const references = [...byId.values()].slice(-maxReferences)
  const { contract, omitted } = boundContract(users, options.maxContractBytes ?? 32_768)
  return { residual, references, contract, contractOmitted: omitted, segmentTokens, ...residualPrior === undefined ? {} : { residualPrior } }
}

/** The first message (usually the task) and as many of the latest as fit. */
function boundContract(users: readonly string[], maxBytes: number): { contract: string[]; omitted: number } {
  let size = 0
  const kept = new Set<number>()
  const order = users.length ? [0, ...Array.from(users.keys()).slice(1).reverse()] : []
  for (const index of order) {
    const length = bytes(users[index]!)
    if (size + length > maxBytes) continue
    size += length
    kept.add(index)
  }
  return { contract: users.filter((_, i) => kept.has(i)), omitted: users.length - kept.size }
}

const CONTRACT_HEADING = '## User messages (verbatim)'
const CONTRACT_LINE = /^- ("[^\n]*")$/u

/**
 * Split a checkpoint LightShadow wrote (possibly inside the host's own
 * framing) into the summary, the exact user messages and the catalog IDs.
 * Text that is no LightShadow checkpoint comes back as the summary.
 */
export function parseCheckpoint(text: string): { summary: string; contract: string[]; ids: string[] } {
  const ids = catalogIds(text)
  let rest = text
  const open = rest.lastIndexOf(CATALOG_OPEN)
  if (open >= 0) {
    const close = rest.indexOf(CATALOG_CLOSE, open)
    rest = rest.slice(0, open) + (close < 0 ? '' : rest.slice(close + CATALOG_CLOSE.length))
  }
  const contract: string[] = []
  const heading = rest.lastIndexOf(`${CONTRACT_HEADING}\n`)
  if (heading >= 0) {
    const lines = rest.slice(heading + CONTRACT_HEADING.length + 1).split('\n')
    let taken = 0
    for (const line of lines) {
      const match = CONTRACT_LINE.exec(line)
      if (match) {
        try {
          const value = JSON.parse(match[1]!) as unknown
          if (typeof value === 'string') { contract.push(value); taken++; continue }
        } catch { /* Not one of ours: the section ends here. */ }
      }
      if (/^\(\d+ earlier user messages? summarized above\)$/u.test(line)) { taken++; continue }
      break
    }
    const consumed = lines.slice(0, taken).join('\n').length + (taken ? 1 : 0)
    rest = rest.slice(0, heading) + rest.slice(heading + CONTRACT_HEADING.length + 1 + consumed)
  }
  return { summary: rest.replace(/\n{3,}/gu, '\n\n').trim(), contract, ids }
}

/** The checkpoint text: the summary, the user's exact messages, and the catalog of references. */
export function renderCheckpoint(summary: string, plan: Pick<ShadowPlan, 'contract' | 'contractOmitted' | 'references'>): string {
  const catalog = plan.references.length ? [
    CATALOG_OPEN,
    'Tool results removed from this conversation. Read one again with the recall tool and its observation_id.',
    ...plan.references.map(ref => `observation_id: ${ref.id} | tool: ${ref.tool} | bytes: ${ref.bytes}${ref.original ? ` | original: ${ref.original.bytes} bytes` : ''}`
      + `${ref.excerpt ? ` | excerpt: ${quote(ref.excerpt)}` : ''}`),
    CATALOG_CLOSE,
  ].join('\n') : ''
  const contract = plan.contract.length ? [CONTRACT_HEADING, ...plan.contract.map(text => `- ${quote(text)}`),
    plan.contractOmitted ? `(${plan.contractOmitted} earlier user message${plan.contractOmitted === 1 ? '' : 's'} summarized above)` : ''].filter(Boolean).join('\n') : ''
  return [summary.trim(), contract, catalog].filter(Boolean).join('\n\n')
}

/** Whether a checkpoint is used: it must be smaller than the segment it replaces. */
export function checkpointAdmitted(text: string, plan: ShadowPlan, estimate: TokenEstimator = defaultEstimate): boolean {
  return estimate(text) < plan.segmentTokens
}

/** The summarizer's input: the residual segment as one transcript. */
export function serializeResidual(messages: readonly ShadowMessage[]): string {
  return messages.map(message => {
    const label = message.role === 'tool' ? `[tool result${message.toolName ? `: ${message.toolName}` : ''}]`
      : message.role === 'summary' ? '[earlier summary]' : `[${message.role}]`
    return `${label}\n${message.text}`
  }).join('\n\n')
}

export function checkpointRecord(base: { host: string; sessionId: string | null; time: string }, fields: {
  kind: ShadowCheckpointRecord['kind']; plan: Pick<ShadowPlan, 'references' | 'contract' | 'segmentTokens'>; checkpointTokens: number
  reason?: ShadowCheckpointRecord['reason']
}): ShadowCheckpointRecord {
  return {
    schemaVersion: 1, type: 'shadow/checkpoint', ...base, kind: fields.kind,
    references: fields.kind === 'standard' ? [] : fields.plan.references,
    userMessages: fields.plan.contract.length, segmentTokens: fields.plan.segmentTokens, checkpointTokens: fields.checkpointTokens,
    ...fields.reason ? { reason: fields.reason } : {},
  }
}

/**
 * A result the host cuts to a head and tail (DSH's tool-result pruner): save
 * the complete text and name it in the cut, so the model can recall the part
 * that was removed. Returns the reference, or undefined when saving failed.
 */
export function externalizeCut(text: string, options: { artifacts: ArtifactPort; tool?: string; callId?: string | null }): ShadowReference | undefined {
  const ref = options.artifacts.save(text)
  if (options.artifacts.read(ref.sha256) !== text) return undefined
  return { id: referenceId(ref.sha256), sha256: ref.sha256, bytes: ref.bytes, tool: options.tool ?? 'tool', callId: options.callId ?? null,
    excerpt: boundedExcerpt(text) }
}

/** The note that replaces the host's own cut marker. */
export function cutNote(reference: ShadowReference, removedChars: number): string {
  return `\n\n[... ${removedChars} characters removed here to save context; LightCode kept the complete output: `
    + `call ${RECALL_TOOL_NAME} with observation_id ${reference.id} and a query (an exact string it contains) to read any part of it ...]\n\n`
}

export interface RecallArguments {
  readonly observation_id?: unknown
  readonly query?: unknown
  readonly original?: unknown
}

export type RecallResult =
  | { readonly ok: true; readonly text: string; readonly complete: boolean; readonly lines?: readonly [number, number]; readonly totalLines?: number }
  | { readonly ok: false; readonly error: string }

/**
 * The recall tool. Only references in this session's checkpoints are
 * reachable. A stored result up to `windowBytes` comes back whole; a larger
 * one needs a query and returns the lines around its first literal match.
 */
export function recallObservation(args: RecallArguments, options: {
  readonly lookup: (id: string) => ShadowReference | undefined
  readonly artifacts: ArtifactPort
  readonly windowBytes?: number
}): RecallResult {
  const id = typeof args.observation_id === 'string' ? args.observation_id.trim() : ''
  if (!id) return { ok: false, error: 'pass an observation_id from the observation catalog' }
  const reference = options.lookup(id)
  if (!reference) return { ok: false, error: `unknown observation_id ${id}; use one listed in the observation catalog` }
  const wantOriginal = args.original === true || args.original === 'true'
  if (wantOriginal && !reference.original) return { ok: false, error: `${id} was not shortened by LightCode; recall it without original` }
  const hash = wantOriginal ? reference.original!.sha256 : reference.sha256
  const text = options.artifacts.read(hash)
  if (text === undefined) return { ok: false, error: `${id} is no longer stored (LightCode keeps originals for a limited number of days)` }
  const windowBytes = options.windowBytes ?? SHADOW_RECALL_WINDOW_BYTES
  if (bytes(text) <= windowBytes) return { ok: true, text, complete: true }
  const query = typeof args.query === 'string' ? args.query : ''
  if (!query) return { ok: false, error: `${id} has ${bytes(text)} bytes; pass a query: an exact string it contains (a symbol, path or error message)` }
  const lines = text.split('\n')
  const hit = lines.findIndex(line => line.includes(query))
  if (hit < 0) return { ok: false, error: `${JSON.stringify(query)} does not occur in ${id}; try a shorter exact string` }
  // Grow the window around the match one line at a time, alternating sides.
  let start = hit, end = hit + 1, size = bytes(lines[hit]!)
  if (size > windowBytes) {
    const clipped = Buffer.from(lines[hit]!, 'utf8').subarray(0, windowBytes).toString('utf8').replace(/�$/u, '')
    return { ok: true, text: clipped, complete: false, lines: [hit + 1, hit + 1], totalLines: lines.length }
  }
  for (let grew = true; grew;) {
    grew = false
    if (start > 0 && size + bytes(lines[start - 1]!) + 1 <= windowBytes) { start--; size += bytes(lines[start]!) + 1; grew = true }
    if (end < lines.length && size + bytes(lines[end]!) + 1 <= windowBytes) { size += bytes(lines[end]!) + 1; end++; grew = true }
  }
  return { ok: true, text: lines.slice(start, end).join('\n'), complete: false, lines: [start + 1, end], totalLines: lines.length }
}

/** How a recall result reads to the model. */
export function renderRecall(id: string, result: RecallResult): string {
  if (!result.ok) return `recall failed: ${result.error}`
  if (result.complete) return result.text
  return `[${id}: lines ${result.lines![0]}-${result.lines![1]} of ${result.totalLines}]\n${result.text}`
}

/** Fold every checkpoint record into a lookup of reachable references (later records win). */
export function referenceIndex(records: Iterable<{ type: string }>): Map<string, ShadowReference> {
  const index = new Map<string, ShadowReference>()
  for (const record of records) {
    if (record.type !== 'shadow/checkpoint') continue
    for (const reference of (record as ShadowCheckpointRecord).references) index.set(reference.id, reference)
  }
  return index
}

