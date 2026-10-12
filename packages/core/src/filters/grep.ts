import { literalCommand } from '../command.ts'
import { resolveFilterOptions } from '../filter-options.ts'
import { ProjectionBuilder, sourceLines } from '../projection-map.ts'
import type { MappedProjection } from '../projection-map.ts'
import type { EconomyFilter, FilterInput } from '../types.ts'

const FILE_LINE = /^([^:\r\n]+):([1-9]\d*):/
// A filename or a replacement string can itself look like filename:line:text.
// Require record output, not just a matching line regex.
const NON_RECORD = /^(?:--(?:json|files(?:-with(?:out)?-match(?:es)?)?|count(?:-matches)?|only-matching|replace|heading|vimgrep|passthru|null(?:-data)?|byte-offset|context|before-context|after-context|no-filename|no-line-number)(?:=|$)|-[^-]*[clLozZbABChN])/

/** Only recognized filename:line:text records may be reduced; preserve their order. */
function projectMapped(input: FilterInput): MappedProjection | undefined {
  const options = resolveFilterOptions(input.options)
  if (options === undefined) return undefined
  const maxPerFile = options.grep.maxPerFile
  const argv = literalCommand(input.command)
  if (argv === undefined || !['grep', 'rg', 'ripgrep'].includes(argv[0] ?? '')
    || argv.some(arg => NON_RECORD.test(arg))
    || (argv[0] !== 'grep' && argv.some(arg => /^-[^-]*r/.test(arg)))
    || input.exitCode !== 0 || /[\u001b\0]/.test(input.stdout)) return undefined
  const lines = sourceLines(input.stdout)
  if (lines.length === 0 || lines.some(line => !FILE_LINE.test(line.text))) return undefined
  const builder = new ProjectionBuilder(input.stdout)
  const counts = new Map<string, number>()
  for (const line of lines) {
    const file = FILE_LINE.exec(line.text)![1]!
    const count = (counts.get(file) ?? 0) + 1
    counts.set(file, count)
    if (count <= maxPerFile) builder.keep(line.start, line.end)
  }
  for (const [file, count] of counts) {
    if (count <= maxPerFile) continue
    builder.newline()
    builder.generate(`  ... (${count - maxPerFile} more matches in ${file})\n`, 'omitted-search-matches')
  }
  if ([...counts.values()].some(count => count > maxPerFile)) {
    builder.generate('[search sample; omitted matches are counted above, not shown]\n', 'search-preview-warning')
  }
  return builder.finish()
}

export const grepFilter: EconomyFilter = {
  name: 'grep',
  transformation: 'preview',
  project: input => projectMapped(input)?.text,
  projectMapped,
}
