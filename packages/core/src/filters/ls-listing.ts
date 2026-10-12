import { inspectShell } from '../shell-inspection.ts'
import { ProjectionBuilder, sourceLines } from '../projection-map.ts'
import type { EconomyFilter, FilterInput } from '../types.ts'

// POSIX/BSD/GNU long listing: permission flags, links, owner, group, size,
// month/day/time-or-year OR ISO date/time, followed by the exact filename tail.
const ROW = /^([bcdlps-][rwxStTs-]{9}[+@.]?)\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(?:(?:[A-Za-z]{3}\s+\d{1,2}\s+(?:\d{2}:\d{2}|\d{4}))|(?:\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}))\s+(.+)$/

/** Explicit directory preview, not permission/ownership evidence. Unknown rows are untouched. */
function projectMapped(input: FilterInput) {
  if (!inspectShell(input.command)?.heads.includes('ls') || input.exitCode !== 0 || /[\u001b\0]|\r(?!\n)/.test(input.stdout)) return undefined
  const lines = sourceLines(input.stdout)
  if (lines.filter(line => ROW.test(line.text)).length < 3) return undefined
  const builder = new ProjectionBuilder(input.stdout)
  builder.generate('[directory listing: type, bytes, name; permissions/owners/timestamps not shown]\n', 'directory-preview')
  for (const line of lines) {
    const match = ROW.exec(line.text)
    if (!match) { builder.keep(line.start, line.end); continue }
    const name = match[3]!
    builder.keep(line.start, line.start + 1)
    builder.generate(` ${match[2]} `, 'directory-size')
    builder.keep(line.start + line.text.length - name.length, line.end)
  }
  return builder.finish()
}

export const lsListingFilter: EconomyFilter = {
  name: 'ls-listing', transformation: 'preview', projectMapped,
  project: input => projectMapped(input)?.text,
}
