import { ProjectionBuilder, sourceLines } from '../projection-map.ts'
import type { MappedProjection } from '../projection-map.ts'

/** Only fields present in the pinned upstream built-ins. No executable rules or file lookup. */
export interface RtkRule {
  readonly id: `rtk/${string}`
  readonly description: string
  readonly match_command: string
  readonly strip_ansi?: boolean
  readonly filter_stderr?: boolean
  readonly strip_lines_matching?: readonly string[]
  readonly keep_lines_matching?: readonly string[]
  readonly match_output?: readonly { pattern: string; message: string; unless?: string }[]
  readonly truncate_lines_at?: number
  readonly tail_lines?: number
  readonly max_lines?: number
  readonly on_empty?: string
}

/** Scoped ASCII case folding used by the pinned spring-boot rule; reject unknown syntax. */
function regex(pattern: string): RegExp {
  const expanded = pattern.replace(/\(\?i:([a-zA-Z]+)\)/g, (_match, word: string) =>
    [...word].map(ch => `[${ch.toLowerCase()}${ch.toUpperCase()}]`).join(''))
  if (/\(\?[a-z-]/.test(expanded)) throw new Error('unsupported RTK regex flags')
  return new RegExp(expanded, 'u')
}

export interface CompiledRtkRule {
  readonly rule: RtkRule
  matches(command: string): boolean
  project(raw: string): MappedProjection
}

/** Retained line fragments carry their original offsets through ANSI stripping and truncation. */
interface Fragment { readonly text: string; readonly start?: number }
interface Line { readonly parts: readonly Fragment[] }
const textOf = (line: Line) => line.parts.map(part => part.text).join('')
const generated = (text: string): Line => ({ parts: [{ text }] })

function prefix(line: Line, length: number): Line {
  const parts: Fragment[] = []
  for (const part of line.parts) {
    if (length <= 0) break
    parts.push({ ...part, text: part.text.slice(0, length) })
    length -= part.text.length
  }
  return { parts }
}

/** Compile trusted bundled data once. This function does not execute commands or load custom TOML. */
export function compileRtkRule(rule: RtkRule): CompiledRtkRule {
  const command = regex(rule.match_command)
  const strip = (rule.strip_lines_matching ?? []).map(regex)
  const keep = (rule.keep_lines_matching ?? []).map(regex)
  if (strip.length && keep.length) throw new Error('RTK strip/keep rules are mutually exclusive')
  const shortcuts = (rule.match_output ?? []).map(item => ({
    ...item, pattern: regex(item.pattern), unless: item.unless === undefined ? undefined : regex(item.unless),
  }))
  return {
    rule,
    matches: text => command.test(text),
    project(raw) {
      const builder = new ProjectionBuilder(raw)
      let lines: Line[] = sourceLines(raw).map(line => {
        if (!rule.strip_ansi) return { parts: [{ text: line.text, start: line.start }] }
        const parts: Fragment[] = []
        let at = 0
        for (const match of line.text.matchAll(/\x1b\[[0-9;]*[a-zA-Z]/g)) {
          if (match.index > at) parts.push({ text: line.text.slice(at, match.index), start: line.start + at })
          at = match.index + match[0].length
        }
        if (at < line.text.length) parts.push({ text: line.text.slice(at), start: line.start + at })
        return { parts }
      })
      const blob = lines.map(textOf).join('\n')
      for (const shortcut of shortcuts) {
        if (shortcut.pattern.test(blob) && !shortcut.unless?.test(blob)) {
          builder.generate(shortcut.message, 'rtk-output-summary'); return builder.finish()
        }
      }
      lines = lines.filter(line => !strip.some(re => re.test(textOf(line)))
        && (keep.length === 0 || keep.some(re => re.test(textOf(line)))))
      const maxChars = rule.truncate_lines_at
      if (maxChars !== undefined) lines = lines.map(line => {
        const chars = [...textOf(line)]
        if (chars.length <= maxChars) return line
        const head = prefix(line, chars.slice(0, Math.max(0, maxChars - 3)).join('').length)
        return { parts: [...head.parts, { text: '...' }] }
      })
      if (rule.tail_lines !== undefined && lines.length > rule.tail_lines) {
        const omitted = lines.length - rule.tail_lines
        lines = [generated(`... (${omitted} lines omitted)`), ...lines.slice(omitted)]
      }
      if (rule.max_lines !== undefined && lines.length > rule.max_lines) {
        const omitted = lines.length - rule.max_lines
        lines = [...lines.slice(0, rule.max_lines), generated(`... (${omitted} lines truncated)`)]
      }
      if (lines.map(textOf).join('\n').trim() === '' && rule.on_empty !== undefined) {
        builder.generate(rule.on_empty, 'rtk-empty-summary'); return builder.finish()
      }
      for (const [index, line] of lines.entries()) {
        if (index !== 0) builder.generate('\n', 'rtk-line-separator')
        for (const part of line.parts) {
          if (part.start !== undefined) builder.keep(part.start, part.start + part.text.length)
          else builder.generate(part.text, 'rtk-preview')
        }
      }
      return builder.finish()
    },
  }
}
