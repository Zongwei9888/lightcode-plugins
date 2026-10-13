/**
 * Lossless layouts for the results of a host's own search tools (grep, glob,
 * find). No shell is involved, so there is no command to recognize: the
 * adapter says which tool produced the text. Every function checks the exact
 * rendering it is given and keeps every match, path, line number and their
 * order; anything unexpected returns undefined and the result passes.
 */
import { ProjectionBuilder, sourceLines } from './projection-map.ts'
import type { MappedProjection } from './projection-map.ts'
import type { FilterCandidate } from './types.ts'

export interface NativeSearchMatch {
  readonly path: string
  readonly lineNumber: number
  readonly line: string
}

const UNSAFE = /[\r\n\0]/
const native = (filter: 'native-grep' | 'native-glob', projection: MappedProjection | undefined): FilterCandidate | undefined =>
  projection === undefined ? undefined : { ...projection, filter, transformation: 'lossless-formatting' }

/**
 * `Found N matches`, then each file's path and one `Line N: text` row per
 * match (DeepSeek Harness `grep`). Only the complete rendering of `matches`
 * qualifies, so a result the host capped or abridged is never touched. The
 * `Line ` of each row goes; paths, numbers and text stay.
 */
export function nativeGrepSections(matches: readonly NativeSearchMatch[], rendered: string): FilterCandidate | undefined {
  if (matches.length === 0) return undefined
  const groups = new Map<string, NativeSearchMatch[]>()
  for (const match of matches) {
    if (typeof match?.path !== 'string' || match.path === '' || UNSAFE.test(match.path) || typeof match.line !== 'string'
      || UNSAFE.test(match.line) || !Number.isSafeInteger(match.lineNumber) || match.lineNumber < 1) return undefined
    const group = groups.get(match.path) ?? []
    group.push(match)
    groups.set(match.path, group)
  }
  const header = `Found ${matches.length} ${matches.length === 1 ? 'match' : 'matches'}\n\n`
  const body = [...groups].map(([path, group]) => `${path}\n${group.map(m => `Line ${m.lineNumber}: ${m.line}`).join('\n')}`).join('\n\n')
  if (rendered !== header + body) return undefined
  const builder = new ProjectionBuilder(rendered)
  let offset = header.length
  builder.keep(0, offset)
  for (const [path, group] of groups) {
    builder.keep(offset, offset + path.length + 1)
    offset += path.length + 1
    for (const match of group) {
      const length = `Line ${match.lineNumber}: ${match.line}`.length
      builder.keep(offset + 'Line '.length, offset + length)
      offset += length
      if (rendered[offset] === '\n') { builder.keep(offset, offset + 1); offset += 1 }
    }
    if (rendered[offset] === '\n') { builder.keep(offset, offset + 1); offset += 1 }
  }
  return native('native-grep', builder.finish())
}

/** pi `grep` rows: `path:N: text` for a match, `path-N- text` for a context line. */
const MATCH_ROW = /^([^:\r\n\0]+):([1-9]\d*): /
const CONTEXT_REST = /^-[1-9]\d*- /

/**
 * `path:line: text` rows and `path-line- text` context rows (pi `grep`). Runs
 * of at least three rows of one file are grouped under its path; each row
 * keeps its number and its `:` (match) or `-` (context) separator, so every
 * row is still there. Notices and anything else stay verbatim.
 */
export function nativeGrepRecords(rendered: string): FilterCandidate | undefined {
  if (/[\u001b\0]|\r(?!\n)/.test(rendered)) return undefined
  const lines = sourceLines(rendered)
  const files = new Set<string>()
  for (const line of lines) {
    const file = MATCH_ROW.exec(line.text)?.[1]
    if (file !== undefined) files.add(file)
  }
  if (files.size === 0) return undefined
  // A context row names no separator of its own: it belongs to the longest matched file it starts with.
  const longestFirst = [...files].sort((a, b) => b.length - a.length)
  const rowOf = (text: string): { file: string; context: boolean } | undefined => {
    const file = MATCH_ROW.exec(text)?.[1]
    if (file !== undefined) return { file, context: false }
    const owner = longestFirst.find(candidate => text.startsWith(candidate) && CONTEXT_REST.test(text.slice(candidate.length)))
    return owner === undefined ? undefined : { file: owner, context: true }
  }
  const rows = lines.map(line => rowOf(line.text))
  const builder = new ProjectionBuilder(rendered)
  let grouped = false
  for (let i = 0; i < lines.length;) {
    const row = rows[i]
    let end = i + 1
    if (row !== undefined) while (end < lines.length && rows[end]?.file === row.file) end++
    if (row === undefined || end - i < 3 || row.file.length < 4) {
      builder.keep(lines[i]!.start, lines[i]!.end); i++; continue
    }
    const context = rows.slice(i, end).some(item => item!.context)
    builder.generate(context ? '[matches and context lines in ' : '[matches in ', 'search-layout')
    builder.keep(lines[i]!.start, lines[i]!.start + row.file.length)
    builder.generate(context ? '; every line retained]\n' : '; every match retained]\n', 'search-layout')
    for (; i < end; i++) {
      builder.generate('  ', 'search-layout')
      builder.keep(lines[i]!.start + row.file.length + 1, lines[i]!.end)
    }
    grouped = true
  }
  return grouped ? native('native-grep', builder.finish()) : undefined
}

/**
 * One path per line in the host's order (DeepSeek Harness `glob`), exactly
 * the complete `paths`: consecutive paths in one directory are grouped under it.
 */
export function nativePathList(paths: readonly string[], rendered: string): FilterCandidate | undefined {
  if (paths.length === 0 || !paths.every(path => typeof path === 'string' && path !== '' && !UNSAFE.test(path))
    || rendered !== paths.join('\n')) return undefined
  return nativePathLines(rendered)
}

/**
 * Path lines (pi `find`, DeepSeek Harness `glob`) with any notices: consecutive
 * paths in one directory are grouped under it, in their original order. Lines
 * that are not a path inside a directory (notices, blank lines, top-level
 * names, directories ending in `/`) stay verbatim and end a group.
 */
export function nativePathLines(rendered: string): FilterCandidate | undefined {
  if (/[\u001b\0]|\r/.test(rendered)) return undefined
  const lines = sourceLines(rendered)
  const directoryOf = (text: string) => {
    const slash = text.lastIndexOf('/')
    return slash <= 0 || slash === text.length - 1 || /^[[(]/.test(text) ? undefined : text.slice(0, slash + 1)
  }
  const builder = new ProjectionBuilder(rendered)
  builder.generate('[paths grouped by directory; original order retained]\n', 'glob-layout')
  let grouped = false
  for (let i = 0; i < lines.length;) {
    const first = lines[i]!
    const directory = directoryOf(first.text)
    let end = i + 1
    if (directory !== undefined) while (end < lines.length && directoryOf(lines[end]!.text) === directory) end++
    if (directory === undefined || end - i < 2) {
      builder.keep(first.start, first.end); i++; continue
    }
    builder.keep(first.start, first.start + directory.length)
    builder.generate('\n', 'glob-layout')
    for (; i < end; i++) {
      const line = lines[i]!
      builder.generate('  ', 'glob-layout')
      builder.keep(line.start + directory.length, line.end)
    }
    builder.newline()
    grouped = true
  }
  return grouped ? native('native-glob', builder.finish()) : undefined
}
