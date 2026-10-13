/**
 * DSH 0.2.x `bash` results, built the way `@deepseek-ai/dsh-tool-bash` builds
 * them (canonical value + `renderResult` text). Kept in step with the
 * published harness by the end-to-end suite, which runs the real tool.
 */
export interface Streams { stdout?: string; stderr?: string; exitCode?: number | null; signal?: string | null; timedOut?: boolean
  stdoutTruncated?: boolean; stderrTruncated?: boolean; denied?: boolean }

export function bashValue(options: Streams) {
  return {
    kind: 'foreground' as const, cwd: '/work', exitCode: options.exitCode === undefined ? 0 : options.exitCode,
    signal: options.signal ?? null, timedOut: options.timedOut ?? false, aborted: false, timeoutMs: 120000,
    stdout: { text: options.stdout ?? '', truncated: options.stdoutTruncated ?? false },
    stderr: { text: options.stderr ?? '', truncated: options.stderrTruncated ?? false },
    ...options.denied === undefined ? {} : { sandbox: { mode: 'workspace-write', denied: options.denied } },
  }
}

const streamText = (text: string, truncated: boolean) => truncated ? `${text}\n[output truncated; full output: /tmp/spill]` : text

export function renderBash(value: ReturnType<typeof bashValue>): string {
  const out = streamText(value.stdout.text, value.stdout.truncated)
  const err = streamText(value.stderr.text, value.stderr.truncated)
  let body = out
  if (err.length > 0) {
    if (body.length > 0 && !body.endsWith('\n')) body += '\n'
    body += `[stderr]\n${err}`
  }
  if (body.length === 0) body = '(no output)'
  const markers: string[] = []
  if (value.sandbox?.denied) markers.push('[sandbox: file access denied under workspace-write mode]')
  if (value.timedOut) markers.push(`[timed out after ${value.timeoutMs}ms]`)
  if (value.signal !== null) markers.push(`[killed by signal: ${value.signal}]`)
  else if (value.exitCode !== 0) markers.push(`[exit code: ${value.exitCode}]`)
  if (markers.length === 0) return body
  if (!body.endsWith('\n')) body += '\n'
  return body + markers.join('\n')
}

export function bashResult(options: Streams) {
  const value = bashValue(options)
  return { isError: false as const, value, content: [{ type: 'text' as const, text: renderBash(value) }] }
}

/** A pytest -v run long enough for the pytest filter to fold its passing rows. */
export function pytestOutput(passing = 60, failing = 0): string {
  const rows = [
    '============================= test session starts ==============================',
    'platform darwin -- Python 3.12.4, pytest-8.3.2, pluggy-1.5.0 -- /usr/bin/python3',
    'rootdir: /work',
    `collected ${passing + failing} items`,
    '',
  ]
  for (let i = 0; i < passing; i++) rows.push(`tests/test_inventory.py::test_case_${i} PASSED${' '.repeat(20)}[${String(Math.round((i + 1) * 100 / (passing + failing))).padStart(3)}%]`)
  for (let i = 0; i < failing; i++) rows.push(`tests/test_inventory.py::test_broken_${i} FAILED${' '.repeat(20)}[100%]`)
  if (failing > 0) {
    rows.push('', '=================================== FAILURES ===================================')
    for (let i = 0; i < failing; i++) {
      rows.push(`_______________________________ test_broken_${i} ________________________________`, '',
        `    def test_broken_${i}():`, '>       assert parse_qty("1,200") == 1200', 'E       ValueError: invalid literal for int()', '',
        'tests/test_inventory.py:42: ValueError')
    }
    rows.push('=========================== short test summary info ============================')
    for (let i = 0; i < failing; i++) rows.push(`FAILED tests/test_inventory.py::test_broken_${i} - ValueError: invalid literal for int()`)
    rows.push(`========================= ${failing} failed, ${passing} passed in 0.41s =========================`)
  } else rows.push(`============================== ${passing} passed in 0.38s ==============================`)
  return rows.join('\n') + '\n'
}
