import { mayProject } from '@lightcode/core'
import { normalizeShellCommand } from '@lightcode/mechanisms'
import { cliContext, onPath, shellQuote } from './context.ts'

/** Codex hook input fields LightCode reads (see the Codex hooks schema). */
interface CodexHookInput {
  readonly hook_event_name?: unknown
  readonly session_id?: unknown
  readonly tool_use_id?: unknown
  readonly tool_name?: unknown
  readonly tool_input?: { readonly command?: unknown } | null
  readonly cwd?: unknown
}

const MAX_INPUT = 4 * 1024 * 1024

/** The wrapper prefix; a command that already starts with it is never wrapped twice. */
export const WRAPPER = 'lc run'

/**
 * Codex PreToolUse: wrap a recognizable shell script as
 * `lc run --host codex --session <id> --call <id> -c '<script>'`.
 * Everything else, and any error, produces no output (Codex passthrough).
 * The model's history keeps the original command; Codex re-applies its
 * exec policy and approval to the rewritten one.
 */
export function codexPreToolUse(input: CodexHookInput, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Bash') return undefined
  const script = input.tool_input?.command
  if (typeof script !== 'string' || script.trim() === '' || script.length > 65_536) return undefined
  const trimmed = script.trimStart()
  if (trimmed.startsWith(`${WRAPPER} `) || /\bapply_?patch\b/.test(script)) return undefined
  if (!mayProject(script)) return undefined
  // A rewrite to an unresolvable `lc` would turn every wrapped command into "command not found".
  if (!onPath('lc', env)) return undefined
  const cwd = typeof input.cwd === 'string' ? input.cwd : undefined
  const context = cliContext({ ...cwd === undefined ? {} : { cwd }, env })
  const { economy } = context.loaded.config
  if (economy.mode === 'off') return undefined
  const sessionId = typeof input.session_id === 'string' && input.session_id ? input.session_id : null
  const callId = typeof input.tool_use_id === 'string' && input.tool_use_id ? input.tool_use_id : null
  // Normalization changes what runs, so it is an `apply` action; observe mode only wraps to record.
  const store = economy.commandNormalization && economy.mode === 'apply' ? context.writable() : undefined
  const normalized = store
    ? normalizeShellCommand({ host: 'codex', journal: store.journal }, { sessionId, callId, tool: 'exec_command', command: script })
    : undefined
  const flags = ['--host', 'codex', ...sessionId ? ['--session', sessionId] : [], ...callId ? ['--call', callId] : []]
  const command = `${WRAPPER} ${flags.map(shellQuote).join(' ')} -c ${shellQuote(normalized ?? script)}`
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { command } } })
}

export async function readStdin(limit = MAX_INPUT): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > limit) throw new Error('hook input too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** `lc hook codex`: never blocks a tool call, never exits non-zero. */
export async function hook(host: string | undefined): Promise<number> {
  try {
    if (host !== 'codex') return 0
    const text = await readStdin()
    const output = codexPreToolUse(JSON.parse(text) as CodexHookInput)
    if (output) process.stdout.write(output + '\n')
  } catch { /* Passthrough. */ }
  return 0
}
