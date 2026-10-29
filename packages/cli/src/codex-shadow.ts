/**
 * LightShadow on Codex: the assisted tier. Codex (0.165) writes the summary
 * itself (for OpenAI models an opaque `compaction` item no plugin can touch),
 * but after every compaction it runs SessionStart hooks with source `compact`
 * and adds their `additionalContext` as a developer message before the next
 * model request. The rollout file is complete by then, so the hook reads the
 * span Codex just compacted, saves its tool outputs and returns the catalog.
 * The recall tool comes from the plugin's MCP server (`tokenwise mcp`); annotated
 * read-only, Codex runs it without asking.
 *
 * Caveats (Codex 0.165): subagent threads get no SessionStart(compact), so no
 * catalog; Codex drops the previous catalog at each compaction, so each one
 * lists every reference the session has.
 */
import { readFileSync, statSync } from 'node:fs'
import { callLabel } from '@tokenwise/mechanisms'
import type { ShadowMessage } from '@tokenwise/mechanisms'
import { catalogContext, shadowApplies } from './shadow.ts'

/** The recall tool as the model sees it: `mcp__<server>__<tool>`. */
export const CODEX_RECALL_TOOL = 'mcp__tokenwise__tokenwise_recall'
/**
 * Codex spills additionalContext over the handler's `additionalContextLimit`
 * (set to 6,000 tokens in hooks.json) to a file; the catalog stays well under.
 */
const CONTEXT_CHARS = 20_000
const MAX_ROLLOUT_BYTES = 512 * 1024 * 1024

/** Under code mode every tool is reached through the JavaScript `exec` tool, and MCP tools are not listed up front. */
export const CODEX_CATALOG_LEAD = 'TokenWise kept the tool results that context compaction removed from this conversation. '
  + `Read any of them again, exactly as first seen, with the ${CODEX_RECALL_TOOL} tool and its observation_id, instead of re-running the command `
  + `(inside exec: \`text(await tools.${CODEX_RECALL_TOOL}({observation_id: "o-…", query: "an exact string"}))\`).`

interface Rollout { readonly type?: unknown; readonly payload?: Record<string, unknown> | null }

export function readRollout(path: string): Rollout[] {
  if (statSync(path).size > MAX_ROLLOUT_BYTES) return []
  const out: Rollout[] = []
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    if (!raw.trim()) continue
    try {
      const value = JSON.parse(raw) as unknown
      if (value && typeof value === 'object') out.push(value as Rollout)
    } catch { /* A partly written last line. */ }
  }
  return out
}

/** The text of `content`/`output`: a string, or the text parts of a list. */
function partsText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const fields = value as Record<string, unknown>
    return partsText(fields.content ?? fields.output)
  }
  if (!Array.isArray(value)) return undefined
  const parts: string[] = []
  for (const item of value as Record<string, unknown>[]) {
    if (typeof item?.text === 'string') parts.push(item.text)
    else if (item?.type === 'input_image' || item?.type === 'image') return undefined
  }
  return parts.join('')
}

/** A shell command item Codex logs while an exec call runs: its command line. */
function nestedCommand(item: unknown): string | undefined {
  const fields = item as { type?: unknown; command?: unknown; server?: unknown; tool?: unknown } | null
  if (fields?.type === 'CommandExecution') {
    if (Array.isArray(fields.command)) {
      const argv = fields.command.filter((part): part is string => typeof part === 'string')
      // ['/bin/zsh', '-lc', '<script>'] is the script.
      return argv.length >= 3 && /^-l?c$/u.test(argv[argv.length - 2]!) ? argv[argv.length - 1] : argv.join(' ')
    }
    if (typeof fields.command === 'string') return fields.command
  }
  if (fields?.type === 'McpToolCall' && typeof fields.server === 'string' && typeof fields.tool === 'string') return `mcp__${fields.server}__${fields.tool}`
  return undefined
}

/**
 * The span the latest compaction covered: response items between the
 * previous `compacted` line (or the start) and the latest one.
 */
export function codexSpan(lines: readonly Rollout[]): ShadowMessage[] {
  const compacted = lines.flatMap((line, i) => line.type === 'compacted' ? [i] : [])
  if (compacted.length === 0) return []
  const end = compacted[compacted.length - 1]!
  const start = compacted.length > 1 ? compacted[compacted.length - 2]! : -1
  const calls = new Map<string, { name: string; call?: string; nested: string[] }>()
  let open: string | undefined
  const out: ShadowMessage[] = []
  for (let i = start + 1; i < end; i++) {
    const line = lines[i]!
    const p = line.payload ?? {}
    if (line.type === 'event_msg' && p.type === 'item_completed') {
      const command = nestedCommand(p.item)
      if (command && open) calls.get(open)?.nested.push(command)
      continue
    }
    if (line.type !== 'response_item') continue
    if (p.type === 'message') {
      const text = partsText(p.content)
      if (!text) continue
      if (p.role === 'assistant') out.push({ role: 'assistant', text })
      else if (p.role === 'user' && !text.startsWith('<environment_context>')) out.push({ role: 'user', text })
      continue
    }
    if ((p.type === 'function_call' || p.type === 'custom_tool_call') && typeof p.call_id === 'string') {
      const name = typeof p.name === 'string' ? p.name : 'tool'
      const args = p.type === 'function_call' ? p.arguments : p.input
      const call = callLabel(args)
      calls.set(p.call_id, { name, ...call ? { call } : {}, nested: [] })
      open = p.call_id
      out.push({ role: 'assistant', text: `${name} ${typeof args === 'string' ? args : JSON.stringify(args ?? {})}` })
      continue
    }
    if ((p.type === 'function_call_output' || p.type === 'custom_tool_call_output') && typeof p.call_id === 'string') {
      const text = partsText(p.output)
      if (open === p.call_id) open = undefined
      if (text === undefined) continue
      const call = calls.get(p.call_id)
      // The commands an exec script ran name the result better than the script.
      const label = call?.nested.length ? callLabel(call.nested.join(' ; ')) : call?.call
      out.push({ role: 'tool', text, toolName: call?.name ?? 'tool', callId: p.call_id, ...label ? { call: label } : {} })
    }
  }
  return out
}

interface StartInput { readonly hook_event_name?: unknown; readonly source?: unknown; readonly session_id?: unknown; readonly transcript_path?: unknown; readonly cwd?: unknown }

/** SessionStart(compact): save the span and hand back the catalog. */
export function codexAfterCompact(input: StartInput): string | undefined {
  if (input.hook_event_name !== 'SessionStart' || input.source !== 'compact' || typeof input.transcript_path !== 'string') return undefined
  if (!shadowApplies(input.cwd)) return undefined
  const messages = codexSpan(readRollout(input.transcript_path))
  const sessionId = typeof input.session_id === 'string' && input.session_id ? input.session_id : null
  return catalogContext({ host: 'codex', sessionId, cwd: input.cwd, messages, lead: CODEX_CATALOG_LEAD, maxChars: CONTEXT_CHARS })
}
