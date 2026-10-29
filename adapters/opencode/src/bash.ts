import type { ShellResult } from '@lightcode-ai/core'

/** OpenCode's `tool.execute.after` output for its `bash` tool (OpenCode 1.19). */
export interface BashOutput {
  title?: string
  /** What the model reads. */
  output: string
  metadata?: { readonly output?: unknown; readonly exit?: unknown; readonly truncated?: unknown; readonly outputPath?: unknown } | null
}

/**
 * OpenCode's bash result as LightCode sees it. The model reads the merged
 * stdout/stderr text, with no exit status in it (the code is in
 * `metadata.exit`). A result OpenCode cut to its tail (its full text is saved
 * to `metadata.outputPath`) is reported as truncated; one without an exit code
 * (a timeout or an abort, which appends a `<shell_metadata>` note) as
 * interrupted; an empty one (`(no output)`) is no result to filter.
 */
export function bashShellResult(args: unknown, output: BashOutput): ShellResult | undefined {
  const command = (args as { command?: unknown } | null | undefined)?.command
  if (typeof command !== 'string' || typeof output.output !== 'string' || output.output === '(no output)') return undefined
  const rendered = output.output
  const exit = output.metadata?.exit
  const base = { command, rendered, stdout: { start: 0, text: rendered } }
  if (typeof exit !== 'number' || !Number.isSafeInteger(exit)) return { ...base, exitCode: -1, interrupted: true }
  return { ...base, exitCode: exit, ...output.metadata?.truncated === true ? { truncated: true } : {} }
}
