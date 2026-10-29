import type { ToolResultEvent } from '@earendil-works/pi-coding-agent'
import type { ShellResult } from '@tokenwise/core'

/**
 * pi's bash result as TokenWise sees it. The model-facing text is the merged
 * stdout/stderr output, followed by `\n\nCommand exited with code N` when the
 * command failed. Truncated output (pi keeps the last 2000 lines / 50KB) and
 * results without an exit code (timeouts, aborts) are reported as such.
 */
export function bashShellResult(event: ToolResultEvent): ShellResult | undefined {
  const input = event.input as { command?: unknown }
  if (typeof input.command !== 'string' || event.content.length !== 1 || event.content[0]!.type !== 'text') return undefined
  const rendered = (event.content[0] as { text: string }).text
  const structured = event.structuredContent as { exit_code?: unknown; truncated?: unknown } | undefined
  const details = event.details as { truncation?: { truncated?: unknown } } | undefined
  const exitCode = structured?.exit_code
  const base = { command: input.command, rendered }
  if (typeof exitCode !== 'number' || !Number.isSafeInteger(exitCode)) {
    return { ...base, exitCode: -1, interrupted: true, stdout: { start: 0, text: rendered } }
  }
  const truncated = details?.truncation?.truncated === true || structured?.truncated === true
  let body = rendered
  if (exitCode !== 0) {
    const status = `Command exited with code ${exitCode}`
    // An unexpected layout is reported as unsupported (an invalid stream offset), never guessed at.
    if (!rendered.endsWith(status)) return { ...base, exitCode, truncated, stdout: { start: -1, text: '' } }
    body = rendered.slice(0, rendered.length - status.length)
    body = body.endsWith('\n\n') ? body.slice(0, -2) : body
  }
  return { ...base, exitCode, truncated, stdout: { start: 0, text: body } }
}
