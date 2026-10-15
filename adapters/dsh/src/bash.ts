import type { ShellResult } from '@lightcode-ai/core'
import type { BashForegroundValue, ContentBlock } from './host.ts'

const STDERR_HEADER = '[stderr]\n'

/**
 * A finished DSH `bash` call as LightCode sees it. DSH renders the model text
 * from the canonical value as: stdout, then `[stderr]\n` and stderr, then
 * status markers (`[exit code: N]`, timeout, signal, sandbox). Both streams are
 * located verbatim in the rendered text, so a projection replaces exactly one
 * stream and keeps every marker byte-for-byte. Any other layout (a result
 * another plugin already rewrote, a future renderer) is reported as
 * unsupported (an invalid stream offset), never guessed at.
 */
export function bashShellResult(command: unknown, value: unknown, content: readonly ContentBlock[]): ShellResult | undefined {
  if (typeof command !== 'string' || !isForeground(value)) return undefined
  if (content.length !== 1 || content[0]!.type !== 'text' || typeof content[0]!.text !== 'string') return undefined
  const rendered = content[0]!.text
  const base = { command, rendered }
  const exitCode = value.exitCode
  // Killed, timed out, stopped or cancelled: the output is not a complete report.
  if (exitCode === null || value.signal !== null || value.timedOut || value.aborted || value.stopped !== undefined
    || value.sandbox?.denied === true || value.sandbox?.runnerFailed === true) {
    return { ...base, exitCode: exitCode ?? -1, interrupted: true, stdout: { start: 0, text: rendered } }
  }
  const truncated = value.stdout.truncated || value.stderr.truncated
  const unsupported = { ...base, exitCode, truncated, stdout: { start: -1, text: '' } }
  const out = value.stdout.text, err = value.stderr.text
  if (!rendered.startsWith(out)) return unsupported
  if (err === '') return { ...base, exitCode, truncated, stdout: { start: 0, text: out } }
  const start = out.length + (out.length > 0 && !out.endsWith('\n') ? 1 : 0) + STDERR_HEADER.length
  if (!rendered.startsWith(STDERR_HEADER, start - STDERR_HEADER.length) || !rendered.startsWith(err, start)) return unsupported
  return { ...base, exitCode, truncated, stdout: { start: 0, text: out }, stderr: { start, text: err } }
}

function isForeground(value: unknown): value is BashForegroundValue {
  if (value === null || typeof value !== 'object') return false
  const v = value as Partial<BashForegroundValue>
  const stream = (s: unknown) => s !== null && typeof s === 'object'
    && typeof (s as { text?: unknown }).text === 'string' && typeof (s as { truncated?: unknown }).truncated === 'boolean'
  return v.kind === 'foreground' && (v.exitCode === null || Number.isSafeInteger(v.exitCode))
    && (v.signal === null || typeof v.signal === 'string') && typeof v.timedOut === 'boolean' && typeof v.aborted === 'boolean'
    && stream(v.stdout) && stream(v.stderr)
}
