/**
 * LightShadow on Grok Build: the assisted tier. Verified against Grok 1.0.70:
 * no hook can change the summary or add context at the moment of compaction
 * (PreCompact/PostCompact output and SessionStart context are dropped), but
 *
 * - PostCompact: the hook reads the span from the session's `updates.jsonl`
 *   (every tool call and result in order, and a `compaction_checkpoint` per
 *   compaction), saves its tool results and keeps the catalog pending. Grok's
 *   segments mode (automatic compaction) writes no `compaction_requests/`;
 *   that file, the exact span of a summary-mode compaction, is the fallback;
 * - the next PostToolUse (any tool) delivers it as `additionalContext`, which
 *   Grok stores in the history; if the turn ends with no tool call, Stop does
 *   (at the cost of one more model round);
 * - the recall tool comes from the plugin's MCP server (`lc mcp`), which
 *   Grok shows the model through `search_tool` / `use_tool`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { callLabel } from '@lightcode-ai/mechanisms'
import type { ShadowMessage } from '@lightcode-ai/mechanisms'
import { catalogText, keepPending, shadowApplies, takePending } from './shadow.ts'

/** The MCP tool as Grok names it: `<server key>__<tool>`. */
export const GROK_RECALL_TOOL = 'lightcode__lightcode_recall'
/** Grok clips additionalContext at 10,000 characters. */
const CONTEXT_CHARS = 9_000
const MAX_UPDATES_BYTES = 512 * 1024 * 1024

export const GROK_CATALOG_LEAD = 'LightCode kept the tool results that context compaction removed from this conversation. '
  + `Read any of them again, exactly as first seen, with the MCP tool ${GROK_RECALL_TOOL} (call use_tool with tool_name "${GROK_RECALL_TOOL}" `
  + 'and arguments {"observation_id": "o-…", "query": "an exact string"}) instead of re-running the command or re-reading the file.'

interface Row { readonly type?: unknown; readonly content?: unknown; readonly tool_calls?: unknown; readonly tool_call_id?: unknown
  readonly synthetic_reason?: unknown; readonly prompt_index?: unknown }

const text = (content: unknown): string | undefined => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  const parts: string[] = []
  for (const part of content as { type?: unknown; text?: unknown }[]) {
    if (part?.type === 'text' && typeof part.text === 'string') parts.push(part.text)
    else return undefined
  }
  return parts.join('\n')
}

/** Grok's `chat_history` as LightShadow reads it: real prompts (they carry `prompt_index`), replies, and tool results with their calls. */
export function grokSpan(history: readonly Row[]): ShadowMessage[] {
  const calls = new Map<string, { name: string; call?: string }>()
  const out: ShadowMessage[] = []
  for (const row of history) {
    if (row.type === 'user') {
      const value = text(row.content)
      if (value && row.synthetic_reason === undefined && row.prompt_index !== undefined) out.push({ role: 'user', text: value })
      continue
    }
    if (row.type === 'assistant') {
      const said: string[] = []
      const value = text(row.content)
      if (value) said.push(value)
      for (const call of Array.isArray(row.tool_calls) ? row.tool_calls as { id?: unknown; name?: unknown; arguments?: unknown }[] : []) {
        if (typeof call?.id !== 'string') continue
        const name = typeof call.name === 'string' ? call.name : 'tool'
        const label = callLabel(call.arguments)
        calls.set(call.id, { name, ...label ? { call: label } : {} })
        said.push(`${name} ${typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? {})}`)
      }
      if (said.length) out.push({ role: 'assistant', text: said.join('\n') })
      continue
    }
    if (row.type === 'tool_result' && typeof row.tool_call_id === 'string') {
      const value = text(row.content)
      if (value === undefined) continue
      const call = calls.get(row.tool_call_id)
      out.push({ role: 'tool', text: value, toolName: call?.name ?? 'tool', callId: row.tool_call_id, ...call?.call ? { call: call.call } : {} })
    }
  }
  return out
}

interface Update { readonly sessionUpdate?: unknown; readonly toolCallId?: unknown; readonly title?: unknown; readonly rawInput?: unknown
  readonly status?: unknown; readonly content?: unknown; readonly _meta?: { readonly 'x.ai/tool'?: { readonly name?: unknown } } }

/**
 * The span of the latest compaction from `updates.jsonl` (the ACP stream Grok
 * records): everything after the compaction before it. When the hook runs
 * before Grok has recorded the latest compaction, the span also covers the
 * one before; references are content-addressed, so that is harmless.
 */
export function grokSpanFromUpdates(lines: readonly string[]): ShadowMessage[] {
  const updates: Update[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const value = JSON.parse(line) as { params?: { update?: Update } }
      if (value?.params?.update && typeof value.params.update === 'object') updates.push(value.params.update)
    } catch { /* A partly written last line. */ }
  }
  const marks = updates.flatMap((update, i) => update.sessionUpdate === 'compaction_checkpoint' ? [i] : [])
  const from = marks.length >= 2 ? marks[marks.length - 2]! + 1 : 0
  const calls = new Map<string, { name: string; call?: string }>()
  const out: ShadowMessage[] = []
  const push = (role: 'user' | 'assistant', piece: string) => {
    const last = out[out.length - 1]
    if (last && last.role === role) out[out.length - 1] = { ...last, text: last.text + piece }
    else out.push({ role, text: piece })
  }
  for (const update of updates.slice(from)) {
    const kind = update.sessionUpdate
    const chunk = (update.content as { text?: unknown } | undefined)?.text
    if (kind === 'user_message_chunk' && typeof chunk === 'string') push('user', chunk)
    else if (kind === 'agent_message_chunk' && typeof chunk === 'string') push('assistant', chunk)
    else if (kind === 'tool_call' && typeof update.toolCallId === 'string') {
      const meta = update._meta?.['x.ai/tool']?.name
      const name = typeof meta === 'string' ? meta : typeof update.title === 'string' ? update.title : 'tool'
      const call = callLabel(update.rawInput)
      calls.set(update.toolCallId, { name, ...call ? { call } : {} })
    } else if (kind === 'tool_call_update' && update.status === 'completed' && typeof update.toolCallId === 'string' && Array.isArray(update.content)) {
      const parts: string[] = []
      for (const item of update.content as { type?: unknown; content?: { type?: unknown; text?: unknown } }[]) {
        if (item?.type === 'content' && item.content?.type === 'text' && typeof item.content.text === 'string') parts.push(item.content.text)
      }
      if (!parts.length) continue
      const call = calls.get(update.toolCallId)
      out.push({ role: 'tool', text: parts.join('\n'), toolName: call?.name ?? 'tool', callId: update.toolCallId, ...call?.call ? { call: call.call } : {} })
    }
  }
  return out
}

/** The newest compaction request in a session directory: the span a summary-mode compaction summarized. */
function latestRequest(sessionDir: string): readonly Row[] | undefined {
  const dir = join(sessionDir, 'compaction_requests')
  if (!existsSync(dir)) return undefined
  let newest: { path: string; mtime: number } | undefined
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    const path = join(dir, name)
    const mtime = statSync(path).mtimeMs
    if (!newest || mtime > newest.mtime) newest = { path, mtime }
  }
  if (!newest) return undefined
  const request = JSON.parse(readFileSync(newest.path, 'utf8')) as { chat_history?: unknown; error?: unknown }
  return request.error == null && Array.isArray(request.chat_history) ? request.chat_history as Row[] : undefined
}

interface GrokInput {
  readonly hook_event_name?: unknown
  readonly session_id?: unknown
  readonly transcript_path?: unknown
  readonly cwd?: unknown
  readonly reason?: unknown
}

const sessionOf = (input: GrokInput) => typeof input.session_id === 'string' && input.session_id ? input.session_id : null

/** PostCompact: save the span and keep its catalog for the next PostToolUse or Stop. Its own output reaches no one. */
export function grokAfterCompact(input: GrokInput): void {
  const sessionId = sessionOf(input)
  if (!sessionId || typeof input.transcript_path !== 'string' || !shadowApplies(input.cwd)) return
  const dir = dirname(input.transcript_path)
  const updates = join(dir, 'updates.jsonl')
  let messages = existsSync(updates) && statSync(updates).size <= MAX_UPDATES_BYTES ? grokSpanFromUpdates(readFileSync(updates, 'utf8').split('\n')) : []
  if (!messages.some(message => message.role === 'tool')) {
    const history = latestRequest(dir)
    messages = history ? grokSpan(history) : []
  }
  if (!messages.some(message => message.role === 'tool')) return
  const text = catalogText({ host: 'grok', sessionId, cwd: input.cwd, messages, lead: GROK_CATALOG_LEAD, maxChars: CONTEXT_CHARS })
  if (text) keepPending('grok', sessionId, text)
}

/** The catalog waiting since the last compaction, once. */
export function grokPendingCatalog(input: GrokInput): string | undefined {
  const sessionId = sessionOf(input)
  return sessionId ? takePending('grok', sessionId) : undefined
}
