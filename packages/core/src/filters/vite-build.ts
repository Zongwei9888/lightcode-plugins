import { developerCommand } from '../command.ts'
import { ProjectionBuilder, sourceLines } from '../projection-map.ts'
import type { MappedProjection } from '../projection-map.ts'
import type { EconomyFilter, FilterInput } from '../types.ts'

/** Known successful build reports only. Keep warnings, all assets, sizes and timings. */
function projectMapped(input: FilterInput): MappedProjection | undefined {
  const argv = developerCommand(input.command)
  if (argv?.[0] !== 'vite' || argv[1] !== 'build' || input.exitCode !== 0
    || argv.some(arg => ['--watch', '-w'].includes(arg))
    || /[\u001b\0]|\r(?!\n)/.test(input.stdout)) return undefined
  const lines = sourceLines(input.stdout)
  const first = lines.find(line => line.text.trim() !== '')
  const last = lines.findLast(line => line.text.trim() !== '')
  if (!/^vite v\d+\.\d+\.\d+[^ ]* building (?:\S+ environment )?for \S+\.\.\.$/.test(first?.text ?? '')
    || !/^[✓✔] built in \d+(?:\.\d+)?(?:ms|s|m)$/.test(last?.text ?? '')) return undefined
  const builder = new ProjectionBuilder(input.stdout)
  for (const line of lines) {
    if (/^(?:transforming|rendering chunks|computing gzip size)\.\.\.$/.test(line.text)) continue
    // Collapse column padding only in an entire recognized asset row. Filenames
    // containing spaces, custom log lines and all diagnostics are kept unchanged.
    if (/^\S+\s+\d+(?:\.\d+)? (?:kB|MB)(?:\s+│\s+(?:gzip|map): +\d+(?:\.\d+)? (?:kB|MB))*$/.test(line.text)) {
      let start = line.start
      for (const match of line.text.matchAll(/ {2,}/g)) {
        const at = line.start + match.index
        builder.keep(start, at + 1)
        start = at + match[0].length
      }
      builder.keep(start, line.end)
    } else builder.keep(line.start, line.end)
  }
  return builder.finish()
}

export const viteBuildFilter: EconomyFilter = {
  name: 'vite-build', transformation: 'noise-removal',
  project: input => projectMapped(input)?.text, projectMapped,
}
