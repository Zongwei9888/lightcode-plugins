import { describe, expect, it } from 'vitest'
import { inspectShell } from '../src/shell-inspection.ts'
import { searchLayoutFilter } from '../src/filters/search-layout.ts'

describe('compound shell inspection and output-only grouping', () => {
  it('recognizes heads without reducing a pipeline to its last command', () => {
    expect(inspectShell('echo "title | not a pipe" && grep -rn "foo" src/ | head -20'))
      .toEqual({ heads: ['echo', 'grep', 'head'], compound: true })
    expect(inspectShell('npm test 2>&1 | tail -40')?.heads).toEqual(['npm', 'tail'])
    expect(inspectShell("rg 'a|b' src; git status")?.heads).toEqual(['rg', 'git'])
  })
  it.each(['rg $(secret) src', 'rg "$PATTERN" src', 'for f in src; do cat "$f"; done', 'cat <<EOF', 'rg x |', 'echo "unclosed', 'rg x &'])('does not pretend to parse %s', command => {
    expect(inspectShell(command)).toBeUndefined()
  })
  it('keeps every search result and surrounding output with exact copy spans', () => {
    const raw = '=== matches ===\r\n' + Array.from({ length: 35 }, (_, i) => `src/deep/file.ts:${i + 1}:  important ${i}\r\n`).join('') + '=== unrelated ===\r\nwarning: keep me\r\n'
    const out = searchLayoutFilter.projectMapped({ command: 'echo title && grep -rn important src | head -40', stdout: raw, exitCode: 0 })!
    expect(out.text.length).toBeLessThan(raw.length)
    expect(out.text).toContain('35:  important 34')
    expect(out.text).toContain('warning: keep me')
    expect(out.text.match(/important /g)).toHaveLength(35)
    for (const span of out.sourceMap.spans) if (span.sourceStart !== undefined) {
      expect(out.text.slice(span.outputStart, span.outputEnd)).toBe(raw.slice(span.sourceStart, span.sourceEnd))
    }
  })
  it('leaves unrelated commands, single-file line-only output and failures untouched', () => {
    for (const [command, stdout, exitCode] of [['cat source', 'src/a.ts:1:foo\n'.repeat(10), 0], ['grep -n foo a.ts', '1:foo\n2:foo\n', 0], ['rg foo', 'src/a.ts:1:foo\n'.repeat(10), 2]] as const) {
      expect(searchLayoutFilter.projectMapped({ command, stdout, exitCode })).toBeUndefined()
    }
  })
})
