import { developerCommand } from '../command.ts'
import { ProjectionBuilder, sourceLines } from '../projection-map.ts'
import type { MappedProjection } from '../projection-map.ts'
import type { EconomyFilter, FilterInput } from '../types.ts'

const DIAGNOSTIC = /^(?:[^\r\n]+\([1-9]\d*,[1-9]\d*\): )?error TS\d+: .+$/

/** Fold adjacent identical complete plain-text diagnostics, preserving all other text. */
function projectMapped(input: FilterInput): MappedProjection | undefined {
  const argv = developerCommand(input.command)
  if (argv?.[0] !== 'tsc' || ![1, 2].includes(input.exitCode)
    || argv.some(arg => /^(?:-w|--watch)(?:=|$)/.test(arg))
    || /[\u001b\0]|\r(?!\n)/.test(input.stdout)) return undefined
  const lines = sourceLines(input.stdout)
  if (!lines.some(line => DIAGNOSTIC.test(line.text))) return undefined
  const builder = new ProjectionBuilder(input.stdout)
  const blockEnd = (start: number): number => {
    let end = start + 1
    // TypeScript's related diagnostic chain is indented. Keep it as part of the
    // comparison: equal headlines with different explanations are NOT duplicates.
    while (end < lines.length && /^[ \t]+\S/.test(lines[end]!.text)) end += 1
    return end
  }
  for (let i = 0; i < lines.length;) {
    const first = lines[i]!
    if (!DIAGNOSTIC.test(first.text)) {
      builder.keep(first.start, first.end)
      i += 1
      continue
    }
    const end = blockEnd(i)
    const rawBlock = input.stdout.slice(first.start, lines[end - 1]!.end)
    let next = end
    let count = 1
    while (next < lines.length && DIAGNOSTIC.test(lines[next]!.text)) {
      const candidateEnd = blockEnd(next)
      if (input.stdout.slice(lines[next]!.start, lines[candidateEnd - 1]!.end) !== rawBlock) break
      count += 1
      next = candidateEnd
    }
    builder.keep(first.start, lines[end - 1]!.end)
    if (count > 1) {
      builder.newline()
      builder.generate(`[identical diagnostic repeated ${count} times consecutively]\n`, 'duplicate-tsc-diagnostics')
    }
    i = next
  }
  return builder.finish()
}

export const tscFilter: EconomyFilter = {
  name: 'tsc', transformation: 'diagnostic-deduplication',
  project: input => projectMapped(input)?.text, projectMapped,
}
