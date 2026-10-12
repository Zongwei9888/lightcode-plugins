import { literalCommand } from '../command.ts'
import { ProjectionBuilder, sourceLines } from '../projection-map.ts'
import type { MappedProjection } from '../projection-map.ts'
import type { EconomyFilter, FilterInput } from '../types.ts'

const PROGRESS = /^Progress: resolved (\d+), reused (\d+), downloaded (\d+), added (\d+)(?:, done)?$/

/** Keep the last snapshot of each monotone progress run; keep everything else. */
function projectMapped(input: FilterInput): MappedProjection | undefined {
  const argv = literalCommand(input.command)
  if (argv?.[0] !== 'pnpm' || !['install', 'i', 'add', 'update', 'remove'].includes(argv[1] ?? '')
    || input.exitCode !== 0 || /[\u001b\0]|\r(?!\n)/.test(input.stdout)) return undefined
  const lines = sourceLines(input.stdout)
  const last = lines.findLast(line => line.text.trim() !== '')
  if (!/^Done in \d+(?:\.\d+)?(?:ms|s|m)(?: using pnpm v\d+\.\d+\.\d+[^ ]*)?$/.test(last?.text ?? '')) return undefined
  const builder = new ProjectionBuilder(input.stdout)
  for (let i = 0; i < lines.length;) {
    const first = lines[i]!
    let previous = PROGRESS.exec(first.text)
    if (previous === null) {
      builder.keep(first.start, first.end)
      i += 1
      continue
    }
    let end = i + 1
    while (end < lines.length) {
      const next = PROGRESS.exec(lines[end]!.text)
      // A reset, a warning, or a lifecycle-script line starts a different run.
      if (next === null || previous[0].endsWith(', done')
        || next.slice(1).some((count, index) => Number(count) < Number(previous![index + 1]))) break
      previous = next
      end += 1
    }
    if (end - i > 1) {
      builder.generate(`[${end - i - 1} intermediate progress updates omitted]\n`, 'pnpm-progress-updates')
    }
    builder.keep(lines[end - 1]!.start, lines[end - 1]!.end)
    i = end
  }
  return builder.finish()
}

export const pnpmInstallFilter: EconomyFilter = {
  name: 'pnpm-install', transformation: 'noise-removal',
  project: input => projectMapped(input)?.text, projectMapped,
}
