import { describe, expect, it } from 'vitest'
import { literalCommand } from '../src/command.ts'
import { projectStaticFilter } from '../src/filters/index.ts'
import { ProjectionBuilder, sourceLines } from '../src/projection-map.ts'

describe('Economy copy provenance', () => {
  it('maps CRLF and multi-code-unit characters without normalization', () => {
    const raw = '甲😀\r\nsecond\r\nlast'
    const lines = sourceLines(raw)
    const builder = new ProjectionBuilder(raw)
    builder.keep(lines[0]!.start, lines[0]!.end)
    builder.generate('[omitted]\n', 'omission')
    builder.keep(lines[2]!.start, lines[2]!.end)
    const projection = builder.finish()
    expect(projection.text).toBe('甲😀\r\n[omitted]\nlast')
    expect(projection.sourceMap.spans[0]).toMatchObject({ outputStart: 0, outputEnd: 5, sourceStart: 0, sourceEnd: 5 })
    expect(projection.sourceMap.spans[1]?.generated).toBe('omission')
  })

  it('distinguishes generated omission counts from copied matches', () => {
    const raw = Array.from({ length: 28 }, (_, i) => `甲.ts:${i + 1}: 😀`).join('\n')
    const projection = projectStaticFilter({ command: 'rg -n "a;b" src/', stdout: raw, exitCode: 0 })!
    expect(projection.sourceMap.spans.some(span => span.generated === 'omitted-search-matches')).toBe(true)
    for (const span of projection.sourceMap.spans) {
      if (span.sourceStart !== undefined) expect(projection.text.slice(span.outputStart, span.outputEnd)).toBe(raw.slice(span.sourceStart, span.sourceEnd))
    }
  })

  it.each(['rg x; true', 'rg x || true', 'cd /tmp; rg x', 'cd /tmp "&&" rg x', 'echo $(rg x)', 'rg "$(cat x)"', 'rg x # comment', 'rg x\\\n', 'rg x | wc -l', 'pytest tests/*', 'rg x ~/src', 'rg x file?.py', 'rg x [ab].py'])('leaves unsupported shell syntax untouched: %s', command => {
    expect(literalCommand(command)).toBeUndefined()
  })

  it('accepts a literal quiet cd prefix without changing quoted arguments', () => {
    expect(literalCommand('cd "/tmp/a b" && python3.12 -m pytest')).toEqual(['python3.12', '-m', 'pytest'])
    expect(literalCommand("rg 'a; b' src/")).toEqual(['rg', 'a; b', 'src/'])
    expect(literalCommand("rg '[ab].*' src/")).toEqual(['rg', '[ab].*', 'src/'])
    expect(literalCommand('git diff HEAD~1')).toEqual(['git', 'diff', 'HEAD~1'])
  })

  it('names a program given by its path by its file name, for the built-in filters only', async () => {
    const { toolArgv } = await import('../src/index.ts')
    expect(toolArgv('/opt/homebrew/bin/python3 -m pytest -v')).toEqual(['python3', '-m', 'pytest', '-v'])
    expect(toolArgv('.venv/bin/pytest -x')).toEqual(['pytest', '-x'])
    expect(toolArgv('git status')).toEqual(['git', 'status'])
    expect(toolArgv('./')).toBeUndefined()
    expect(literalCommand('.venv/bin/pytest -x')).toEqual(['.venv/bin/pytest', '-x'])
  })

  it('accepts a final 2>&1 and | tee <file>, alone or after a quiet cd prefix, but no other redirect or pipe', () => {
    expect(literalCommand('python3 -m pytest -v 2>&1')).toEqual(['python3', '-m', 'pytest', '-v'])
    expect(literalCommand('cd /repo && python3 -m pytest -v 2>&1')).toEqual(['python3', '-m', 'pytest', '-v'])
    expect(literalCommand('pytest 2>&1 -v')).toBeUndefined()
    expect(literalCommand('pytest -v 2>/dev/null')).toBeUndefined()
    expect(literalCommand('pytest -v 2>&1 | tee out.txt')).toEqual(['pytest', '-v'])
    expect(literalCommand('cd /repo && python3 -m pytest -v 2>&1 | tee -a /tmp/first_run.txt')).toEqual(['python3', '-m', 'pytest', '-v'])
    expect(literalCommand('pytest -v | tee $OUT')).toBeUndefined()
    expect(literalCommand('pytest -v | tee out.txt | tail -5')).toBeUndefined()
  })

  it.each(['pytest -s', 'pytest -vs', 'pytest --capture=no', 'pytest --capture tee-sys'])('preserves interleaved live test output: %s', command => {
    const stdout = '================ test session starts ================\ncollected 1 item\nimportant .\n================ 1 passed in 0.05s ================\n'
    expect(projectStaticFilter({ command, stdout, exitCode: 0 })).toBeUndefined()
  })

  it('passes through an incomplete diff instead of synthesizing counts', () => {
    const stdout = 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -0,0 +1,20 @@\n+only one line\n'
    expect(projectStaticFilter({ command: 'git diff', stdout, exitCode: 0 })).toBeUndefined()
  })
})
