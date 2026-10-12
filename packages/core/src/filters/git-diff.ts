import { literalCommand } from '../command.ts'
import { resolveFilterOptions } from '../filter-options.ts'
import { ProjectionBuilder, sourceLines } from '../projection-map.ts'
import type { MappedProjection, SourceLine } from '../projection-map.ts'
import type { EconomyFilter, FilterInput } from '../types.ts'

const NON_PATCH = /^(?:--(?:stat|numstat|shortstat|dirstat|name-only|name-status|raw|summary|check|word-diff|no-patch|quiet|binary)(?:=|$)|-s$)/
const METADATA = /^(?:index |--- |\+\+\+ |old mode |new mode |new file mode |deleted file mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to |Binary files )/

/** Preserve headers and all file identities; only oversized, validated hunks are previewed. */
function projectMapped(input: FilterInput): MappedProjection | undefined {
  const options = resolveFilterOptions(input.options)
  if (options === undefined) return undefined
  const maxHunkLines = options['git-diff'].maxHunkLines
  const argv = literalCommand(input.command)
  if (argv === undefined || argv[0] !== 'git' || argv[1] !== 'diff'
    || argv.some(arg => NON_PATCH.test(arg)) || ![0, 1].includes(input.exitCode)
    || /[\u001b\0]/.test(input.stdout)) return undefined
  const lines = sourceLines(input.stdout)
  if (!lines[0]?.text.startsWith('diff --git ')) return undefined
  const builder = new ProjectionBuilder(input.stdout)
  let oldRemaining = 0
  let newRemaining = 0
  let hunkLines: SourceLine[] = []
  let added = 0
  let removed = 0
  let truncated = false
  const flush = () => {
    const head = Math.floor(maxHunkLines / 2)
    const tail = maxHunkLines - head
    for (const [index, line] of hunkLines.entries()) {
      if (hunkLines.length <= maxHunkLines || index < head || index >= hunkLines.length - tail) {
        builder.keep(line.start, line.end)
      } else if (index === head) {
        builder.newline()
        builder.generate(`  ... (${hunkLines.length - maxHunkLines} lines truncated)\n`, 'omitted-diff-lines')
        truncated = true
      }
    }
    hunkLines = []
  }
  const fileSummary = () => {
    if (added + removed > 0) {
      builder.newline()
      builder.generate(`  +${added} -${removed}\n`, 'diff-change-counts')
    }
    added = 0
    removed = 0
  }
  for (const line of lines) {
    const value = line.text
    if (value === '\\ No newline at end of file') {
      if (hunkLines.length === 0 || hunkLines.at(-1)?.text === value) return undefined
      hunkLines.push(line)
      continue
    }
    if (oldRemaining > 0 || newRemaining > 0) {
      const prefix = value[0]
      if (prefix !== ' ' && prefix !== '+' && prefix !== '-') return undefined
      if (prefix !== '+') oldRemaining -= 1
      if (prefix !== '-') newRemaining -= 1
      if (oldRemaining < 0 || newRemaining < 0) return undefined
      if (prefix === '+') added += 1
      if (prefix === '-') removed += 1
      hunkLines.push(line)
      continue
    }
    flush()
    if (value.startsWith('diff --git ')) {
      fileSummary()
      builder.keep(line.start, line.end)
    } else if (value.startsWith('@@ ')) {
      const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(value)
      if (hunk === null) return undefined
      oldRemaining = Number(hunk[2] ?? 1)
      newRemaining = Number(hunk[4] ?? 1)
      if (!Number.isSafeInteger(oldRemaining) || !Number.isSafeInteger(newRemaining)) return undefined
      builder.keep(line.start, line.end)
    } else if (METADATA.test(value)) builder.keep(line.start, line.end)
    else return undefined
  }
  if (oldRemaining !== 0 || newRemaining !== 0) return undefined
  flush()
  fileSummary()
  if (!truncated) {
    const unchanged = new ProjectionBuilder(input.stdout)
    unchanged.keep(0, input.stdout.length)
    return unchanged.finish()
  }
  if (truncated) builder.generate('[diff sample; omitted lines are counted above; not an applicable patch]\n', 'diff-preview-warning')
  return builder.finish()
}

export const gitDiffFilter: EconomyFilter = {
  name: 'git-diff',
  transformation: 'preview',
  project: input => projectMapped(input)?.text,
  projectMapped,
}
