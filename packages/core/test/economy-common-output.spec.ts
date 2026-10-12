import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { projectStaticFilter } from '../src/filters/index.ts'
import { testProgressFilter } from '../src/filters/test-progress.ts'
import { gitDiffFilter } from '../src/filters/git-diff.ts'

describe('real coding-output coverage without command re-execution', () => {
  it('filters a real Node TAP report without dropping its failure body or totals', () => {
    let raw = ''
    try { execFileSync(process.execPath, ['--test', '--test-reporter=tap', 'test/fixtures/node-tap-fixture.mjs'], { encoding: 'utf8' }) }
    catch (error) { raw = (error as { stdout: string }).stdout }
    expect(raw).toContain('retain this failure evidence')
    const out = projectStaticFilter({ command: 'node --test --test-reporter=tap test/fixtures/node-tap-fixture.mjs', stdout: raw, exitCode: 1 })!
    expect(out.filter).toBe('test-report')
    expect(out.text).toContain('retain this failure evidence')
    expect(out.text).toContain('# fail 1')
    expect(out.text).toContain('# pass 8')
    expect(out.text.length).toBeLessThan(raw.length)
  })
  it('previews a real local ls listing, retaining every name and unknown row', () => {
    const raw = execFileSync('ls', ['-la', 'src/filters'], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } })
    const out = projectStaticFilter({ command: 'pwd && ls -la src/filters', stdout: raw, exitCode: 0 })!
    expect(out.filter).toBe('ls-listing')
    expect(out.text).toContain('test-progress.ts')
    expect(out.text).toContain('permissions/owners/timestamps not shown')
    expect(out.text).not.toMatch(/recover/i)
    expect(out.text.length).toBeLessThan(raw.length)
    for (const span of out.sourceMap.spans) if (span.sourceStart !== undefined) {
      expect(out.text.slice(span.outputStart, span.outputEnd)).toBe(raw.slice(span.sourceStart, span.sourceEnd))
    }
  })
  it('groups a real find result through a mixed inspection command without losing paths', () => {
    const raw = execFileSync('find', ['src/filters', '-type', 'f'], { encoding: 'utf8' })
    const out = projectStaticFilter({ command: 'echo header && find src/filters -type f | sort', stdout: raw, exitCode: 0 })!
    expect(out.filter).toBe('path-list')
    expect(out.text.length).toBeLessThan(raw.length)
    for (const path of raw.trim().split('\n')) expect(out.text).toContain(path.slice(path.lastIndexOf('/') + 1))
  })
  it('collapses positive-status runs but keeps failures, unknown lines and totals verbatim', () => {
    const positives = Array.from({ length: 30 }, (_, i) => `  ✓ test case ${i}\n`).join('')
    const raw = positives + '✗ FAIL: real diagnostic\n    expected: 42\n' + positives + 'tests: 60 passed, 1 failed\n'
    // A tail pipeline can exit 0 even when the upstream runner failed: never invent all-passed.
    const out = testProgressFilter.projectMapped({ command: 'npm test 2>&1 | tail -100', stdout: raw, exitCode: 0 })!
    expect(out.text).toContain('✗ FAIL: real diagnostic\n    expected: 42')
    expect(out.text).toContain('tests: 60 passed, 1 failed')
    expect(out.text).not.toContain('all passed')
    expect(testProgressFilter.projectMapped({ command: 'npm test', stdout: raw, exitCode: 1 })).toBeUndefined()
    expect(testProgressFilter.projectMapped({ command: 'npm test; cat source', stdout: raw, exitCode: 0 })).toBeUndefined()
  })
  it('does not enlarge a fully retained git patch just to append change counts', () => {
    const raw = 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n'
    expect(gitDiffFilter.project({ command: 'git diff', stdout: raw, exitCode: 0 })).toBe(raw)
  })
})
