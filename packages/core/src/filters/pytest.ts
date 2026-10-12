import { literalCommand } from '../command.ts'
import { ProjectionBuilder, sourceLines } from '../projection-map.ts'
import type { MappedProjection } from '../projection-map.ts'
import type { EconomyFilter, FilterInput } from '../types.ts'

const COUNTS = /^(?:\d+ (?:passed|failed|errors?|skipped|deselected|xfailed|xpassed|warnings?))(?:, \d+ (?:passed|failed|errors?|skipped|deselected|xfailed|xpassed|warnings?))*$/

/** Remove only recognized progress; diagnostics and failure bodies remain verbatim. */
function projectMapped(input: FilterInput): MappedProjection | undefined {
  const argv = literalCommand(input.command)
  if (argv === undefined) return undefined
  const pytest = argv[0] === 'pytest'
    || (/^python\d*(?:\.\d+)*$/.test(argv[0] ?? '') && argv[1] === '-m' && argv[2] === 'pytest')
  if (!pytest || ![0, 1].includes(input.exitCode) || /[\u001b\0]/.test(input.stdout)) return undefined
  // Live test output can look exactly like pytest progress; do not classify it.
  if (argv.some((arg, index) => /^-[^-]*s/.test(arg)
    || /^--capture=(?:no|tee-sys)$/.test(arg)
    || (arg === '--capture' && ['no', 'tee-sys'].includes(argv[index + 1] ?? '')))) return undefined
  const lines = sourceLines(input.stdout)
  const last = lines.findLast(line => line.text.trim() !== '')
  if (last === undefined) return undefined
  const summary = last.text.trim().replace(/^=+\s*/, '').replace(/\s*=+$/, '')
  const match = /^(.*?) in \d+(?:\.\d+)?s(?: \([^)]*\))?$/.exec(summary)
  if (match?.[1] === undefined || !COUNTS.test(match[1])) return undefined
  const hasFailure = /\b[1-9]\d* (?:failed|errors?)\b/.test(match[1])
  if ((input.exitCode === 0 && hasFailure) || (input.exitCode === 1 && !hasFailure)) return undefined
  // A log prefix from an unrelated command is not a pytest session.
  const first = lines.find(line => line.text.trim() !== '')
  if (first !== last && !/^=+ test session starts =+$/.test(first?.text.trim() ?? '')
    && !/^[.sFxXE]+\s*(?:\[\s*\d+%\])?$/.test(first?.text.trim() ?? '')) return undefined
  const builder = new ProjectionBuilder(input.stdout)
  let diagnostics = false
  for (const line of lines) {
    // Keep the original summary, including elapsed time and every status count.
    if (line === last) {
      builder.keep(line.start, line.end)
      continue
    }
    const value = line.text.trim()
    // PASSES and captured-output sections can also contain progress-looking text.
    if (/^[-=]{3,}.*[-=]{3,}$/.test(value) && !/^=+ test session starts =+$/.test(value)) diagnostics = true
    if (!diagnostics && (/^=+ test session starts =+$/.test(value)
      || /^(?:\S+\.py\s+)?[.s]+\s*(?:\[\s*\d+%\])?$/.test(value)
      || /^\S+\.py::\S+\s+PASSED\s+\[\s*\d+%\]$/.test(value)
      || value === '')) continue
    builder.keep(line.start, line.end)
  }
  return builder.finish()
}

export const pytestFilter: EconomyFilter = {
  name: 'pytest',
  transformation: 'noise-removal',
  project: input => projectMapped(input)?.text,
  projectMapped,
}
