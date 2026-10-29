/**
 * LightShadow on Claude Code: the assisted tier. Claude Code writes the
 * compaction summary itself and no plugin can replace it, but a plugin can
 *
 * - add a line to the summarizer's instructions (PreCompact stdout),
 * - add context right after the compaction (SessionStart, source `compact`),
 * - ship an MCP server (`lc mcp`) whose tool the model can call.
 *
 * So at SessionStart(compact) the hook reads the transcript, saves the tool
 * results of the span Claude Code just compacted, and returns the catalog of
 * everything this session can recall. The catalog follows the summary in the
 * model's context; the transcript keeps it, so it survives a resume.
 *
 * Verified against Claude Code 2.1.312 (captured payloads and transcripts):
 * - PreCompact can run before the newest tool result is in the transcript, and
 *   can be followed by no compaction at all; SessionStart(compact) sees the
 *   whole span. So PreCompact only shapes the summary and SessionStart works.
 * - additionalContext over 10,000 characters is moved to a file the model is
 *   not told to read: the catalog stays under 9,000.
 * - A subagent's compaction fires the same hooks with the parent's
 *   `transcript_path`; its own transcript is `<session>/subagents/agent-*.jsonl`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { callLabel, SHADOW_ASSISTED_INSTRUCTION } from '@lightcode-ai/mechanisms'
import type { ShadowMessage } from '@lightcode-ai/mechanisms'
import { catalogContext, shadowApplies } from './shadow.ts'

/** The recall tool as the model sees it: `mcp__plugin_<plugin>_<server>__<tool>`. */
export const CLAUDE_RECALL_TOOL = 'mcp__plugin_lightcode_lightcode__lightcode_recall'
/** Claude Code moves additionalContext over 10,000 characters to a file. */
const CONTEXT_CHARS = 9_000
/** Tools that run a subagent: while one is unanswered, a compaction is the subagent's. */
const SUBAGENT_TOOLS = new Set(['Agent', 'Task'])
const MAX_TRANSCRIPT_BYTES = 512 * 1024 * 1024
const MAX_PERSISTED_BYTES = 32 * 1024 * 1024

interface Block { readonly type?: unknown; readonly text?: unknown; readonly id?: unknown; readonly name?: unknown; readonly input?: unknown
  readonly tool_use_id?: unknown; readonly content?: unknown }
interface Line {
  readonly type?: unknown
  readonly subtype?: unknown
  readonly uuid?: unknown
  readonly isSidechain?: unknown
  readonly isCompactSummary?: unknown
  readonly isMeta?: unknown
  readonly message?: { readonly content?: unknown } | null
  readonly toolUseResult?: unknown
  readonly compactMetadata?: { readonly preservedMessages?: { readonly allUuids?: unknown; readonly uuids?: unknown } } | null
}

export function readTranscript(path: string): Line[] {
  if (statSync(path).size > MAX_TRANSCRIPT_BYTES) return []
  const lines: Line[] = []
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    if (!raw.trim()) continue
    try {
      const value = JSON.parse(raw) as unknown
      if (value && typeof value === 'object') lines.push(value as Line)
    } catch { /* A partly written last line. */ }
  }
  return lines
}

const blocks = (line: Line): Block[] => Array.isArray(line.message?.content) ? line.message!.content as Block[] : []

/** The text of a tool_result's content, or undefined when it is not all text (images, tool references). */
function resultText(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  const parts: string[] = []
  for (const item of content as Block[]) {
    if (item?.type !== 'text' || typeof item.text !== 'string') return undefined
    parts.push(item.text)
  }
  return parts.join('\n')
}

/** A large result Claude Code moved to a file: the model saw a preview; the reference keeps the whole text. */
function persisted(line: Line): string | undefined {
  const result = line.toolUseResult as { persistedOutputPath?: unknown } | null | undefined
  const path = result && typeof result === 'object' && typeof result.persistedOutputPath === 'string' ? result.persistedOutputPath : undefined
  if (!path) return undefined
  try { return statSync(path).size <= MAX_PERSISTED_BYTES ? readFileSync(path, 'utf8') : undefined } catch { return undefined }
}

/**
 * The span the latest compaction covered: what the previous compaction kept
 * verbatim, and every main-chain line after its boundary, in file order.
 * Lines kept again by this compaction are included too; references are
 * content-addressed, so listing them early is harmless.
 */
export function claudeSpan(lines: readonly Line[]): ShadowMessage[] {
  let last = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.type === 'system' && lines[i]!.subtype === 'compact_boundary') { last = i; break }
  }
  const kept = new Set<string>()
  const preserved = last >= 0 ? lines[last]!.compactMetadata?.preservedMessages : undefined
  for (const list of [preserved?.allUuids, preserved?.uuids]) {
    if (Array.isArray(list)) for (const uuid of list) if (typeof uuid === 'string') kept.add(uuid)
  }
  const calls = new Map<string, { name: string; call?: string }>()
  const out: ShadowMessage[] = []
  lines.forEach((line, i) => {
    const inSpan = i > last ? line.isSidechain !== true : typeof line.uuid === 'string' && kept.has(line.uuid)
    if (!inSpan) return
    if (line.type === 'assistant') {
      const text: string[] = []
      for (const block of blocks(line)) {
        if (block.type === 'text' && typeof block.text === 'string') text.push(block.text)
        if (block.type === 'tool_use' && typeof block.id === 'string') {
          const name = typeof block.name === 'string' ? block.name : 'tool'
          const call = callLabel(block.input)
          calls.set(block.id, { name, ...call ? { call } : {} })
          text.push(`${name} ${JSON.stringify(block.input ?? {})}`)
        }
      }
      if (text.length) out.push({ role: 'assistant', text: text.join('\n') })
      return
    }
    if (line.type !== 'user') return
    if (line.isCompactSummary === true) {
      const text = resultText(line.message?.content)
      if (text) out.push({ role: 'summary', text })
      return
    }
    if (typeof line.message?.content === 'string') {
      if (line.isMeta !== true) out.push({ role: 'user', text: line.message.content })
      return
    }
    for (const block of blocks(line)) {
      if (block.type === 'text' && typeof block.text === 'string' && line.isMeta !== true) out.push({ role: 'user', text: block.text })
      if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
      const text = persisted(line) ?? resultText(block.content)
      if (text === undefined) continue
      const call = calls.get(block.tool_use_id)
      out.push({ role: 'tool', text, toolName: call?.name ?? 'tool', callId: block.tool_use_id, ...call?.call ? { call: call.call } : {} })
    }
  })
  return out
}

/** Subagent tool calls after the latest boundary that have no result yet. */
function runningSubagents(lines: readonly Line[]): number {
  const open = new Set<string>()
  for (const line of lines) {
    if (line.type === 'system' && line.subtype === 'compact_boundary') { open.clear(); continue }
    // Only the conversation itself: request logs (`api-request-blob`) repeat earlier blocks.
    if ((line.type !== 'assistant' && line.type !== 'user') || line.isSidechain === true) continue
    for (const block of blocks(line)) {
      if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string' && SUBAGENT_TOOLS.has(block.name)) open.add(block.id)
      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') open.delete(block.tool_use_id)
    }
  }
  return open.size
}

/**
 * The transcript of whoever compacted. Claude Code passes the main
 * transcript even for a subagent's compaction; while a subagent call is
 * unanswered, the newest subagent transcript is the one that compacted.
 * Undefined when that cannot be told apart (no subagent transcript).
 */
export function compactedTranscript(transcriptPath: string): Line[] | undefined {
  const main = readTranscript(transcriptPath)
  if (runningSubagents(main) === 0) return main
  const dir = join(dirname(transcriptPath), basename(transcriptPath, '.jsonl'), 'subagents')
  if (!existsSync(dir)) return undefined
  let newest: { path: string; mtime: number } | undefined
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue
    const path = join(dir, name)
    const mtime = statSync(path).mtimeMs
    if (!newest || mtime > newest.mtime) newest = { path, mtime }
  }
  return newest ? readTranscript(newest.path) : undefined
}

interface CompactInput {
  readonly hook_event_name?: unknown
  readonly session_id?: unknown
  readonly transcript_path?: unknown
  readonly source?: unknown
  readonly cwd?: unknown
}

/** PreCompact: one paragraph for the summarizer (plain stdout is appended to its instructions). */
export function claudePreCompact(input: CompactInput): string | undefined {
  return shadowApplies(input.cwd) ? SHADOW_ASSISTED_INSTRUCTION : undefined
}

/** SessionStart after a compaction: save the span and hand back the catalog as additional context. */
export function claudeAfterCompact(input: CompactInput, host = 'claude', toolName = CLAUDE_RECALL_TOOL): string | undefined {
  if (input.source !== 'compact' || typeof input.transcript_path !== 'string') return undefined
  if (!shadowApplies(input.cwd)) return undefined
  const lines = compactedTranscript(input.transcript_path)
  if (!lines) return undefined
  const sessionId = typeof input.session_id === 'string' && input.session_id ? input.session_id : null
  return catalogContext({ host, sessionId, cwd: input.cwd, messages: claudeSpan(lines), toolName, maxChars: CONTEXT_CHARS })
}

/** PreToolUse on LightCode's own recall tool: it only reads what LightCode saved, so it need not ask. */
export function claudeAllowRecall(toolName: unknown, recallTool = CLAUDE_RECALL_TOOL): string | undefined {
  if (toolName !== recallTool) return undefined
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow',
    permissionDecisionReason: 'LightCode recall only reads tool output LightCode saved earlier in this session' } })
}
