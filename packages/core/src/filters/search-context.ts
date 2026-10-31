import { readsFileContent } from '../command.ts'
import { inspectShell } from '../shell-inspection.ts'
import { ProjectionBuilder, sourceLines } from '../projection-map.ts'
import type { MappedProjection, SourceLine } from '../projection-map.ts'
import type { EconomyFilter, FilterInput } from '../types.ts'

/** A match record names its file: `path:12:text`. Context records of the same file are `path-11-text`. */
const MATCH = /^([^:\r\n\0]+):([1-9]\d*):/u

interface Group { readonly from: number; readonly to: number; readonly path?: string }

/**
 * A group between `--` separators is a validated context group when one file
 * owns every row: a match row gives the path, every row is `path:N:` or
 * `path-N-`, line numbers count up by one, and at least one row is context.
 */
function validate(lines: readonly SourceLine[], from: number, to: number): string | undefined {
  const path = lines.slice(from, to).map(line => MATCH.exec(line.text)?.[1]).find(found => found !== undefined)
  if (path === undefined || path.length < 4) return undefined
  let previous: number | undefined
  let context = 0
  for (let i = from; i < to; i++) {
    const text = lines[i]!.text
    if (!text.startsWith(path)) return undefined
    const row = /^([:-])([1-9]\d*)\1/u.exec(text.slice(path.length))
    if (row === null) return undefined
    const number = Number(row[2])
    if (previous !== undefined && number !== previous + 1) return undefined
    previous = number
    if (row[1] === '-') context++
  }
  return context > 0 ? path : undefined
}

/**
 * grep/rg/git grep output with context lines (`-A`, `-B`, `-C`): consecutive
 * groups of one file are listed under one path header. Every match row,
 * context row, line number and `--` separator stays, in order; anything that
 * is not a validated group stays as it is.
 */
function projectMapped(input: FilterInput): MappedProjection | undefined {
  const shell = inspectShell(input.command)
  if (!shell || !(shell.heads.some(head => ['grep', 'rg', 'ripgrep'].includes(head)) || /(?:^|[\s;&|])git\s+grep\b/u.test(input.command))) return undefined
  if (![0, 1].includes(input.exitCode) || /[\u001b\0]|\r(?!\n)/u.test(input.stdout) || readsFileContent(input.command)) return undefined
  const lines = sourceLines(input.stdout)
  const groups: Group[] = []
  let start = 0
  for (let i = 0; i <= lines.length; i++) {
    if (i === lines.length || lines[i]!.text === '--') {
      if (i > start) {
        const path = validate(lines, start, i)
        groups.push(path === undefined ? { from: start, to: i } : { from: start, to: i, path })
      }
      start = i + 1
    }
  }
  const owner = new Map<number, string>()
  for (const group of groups) if (group.path !== undefined) for (let i = group.from; i < group.to; i++) owner.set(i, group.path)
  if (owner.size < 3) return undefined
  const builder = new ProjectionBuilder(input.stdout)
  let open: string | undefined
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const path = owner.get(i)
    if (path !== undefined) {
      if (open !== path) {
        builder.generate('[lines from ', 'search-context')
        builder.keep(line.start, line.start + path.length)
        builder.generate('; every match and context line retained]\n', 'search-context')
        open = path
      }
      builder.generate('  ', 'search-context')
      builder.keep(line.start + path.length + 1, line.end)
      continue
    }
    // A separator between two groups of the open file stays inside its listing.
    if (line.text === '--' && open !== undefined && owner.get(i + 1) === open) {
      builder.generate('  ', 'search-context')
      builder.keep(line.start, line.end)
      continue
    }
    open = undefined
    builder.keep(line.start, line.end)
  }
  return builder.finish()
}

export const searchContextFilter: EconomyFilter = {
  name: 'search-context', transformation: 'lossless-formatting', projectMapped,
  project: input => projectMapped(input)?.text,
}
