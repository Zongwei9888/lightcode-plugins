import { describe, expect, it } from 'vitest'
import { gitDiffFilter, grepFilter, pytestFilter } from '../src/filters/index.ts'

const matches = Array.from({ length: 60 }, (_, i) => `src/a.ts:${i + 1}: TODO`).join('\n')

describe('Economy format and command safety', () => {
  it.each(['rg -l TODO', 'rg --files', 'rg --count TODO', 'rg -r replacement TODO', 'grep -lc TODO'])('does not treat filename or count output as matching records: %s', command => {
    expect(grepFilter.project({ command, stdout: matches, exitCode: 0 })).toBeUndefined()
  })

  it('marks search output as an incomplete preview and preserves recursive grep support', () => {
    const output = grepFilter.project({ command: 'grep -rn TODO src/', stdout: matches, exitCode: 0 })
    expect(output).toContain('search sample')
    expect(output).toContain('35 more matches')
  })

  it('keeps successful captured output and the original summary timing', () => {
    const diagnostic = '================================ PASSES ================================\n' +
      '------------------------- Captured stdout call -------------------------\n' +
      'important .\ncollected 100 items\n.....\n'
    const stdout = '================ test session starts ================\ncollected 1 item\n' +
      'tests/test_a.py . [100%]\n' + diagnostic + '================ 1 passed in 0.05s ================\n'
    const result = pytestFilter.project({ command: 'pytest -rP', stdout, exitCode: 0 })!
    expect(result).toContain(diagnostic)
    expect(result).toContain('1 passed in 0.05s')
    expect(result).toContain('collected 1 item')
  })

  it('rejects a diff newline marker without a preceding hunk body', () => {
    expect(gitDiffFilter.project({ command: 'git diff', stdout: 'diff --git a/a b/a\n\\ No newline at end of file\n', exitCode: 0 })).toBeUndefined()
  })
  it.each(['--name-only', '--name-status', '--numstat', '--raw', '--summary', '--check'])('passes through git diff %s', flag => {
    const stdout = 'M\tsrc/a.ts\nD\tsrc/b.ts\n'.repeat(20)
    expect(gitDiffFilter.project({ command: `git diff ${flag}`, stdout, exitCode: 0 }) ?? stdout).toBe(stdout)
  })

  it.each(['cat notes.txt; rg TODO src/', 'echo important && rg TODO src/', 'false || rg TODO src/', 'rg TODO src/ | sort', 'rg TODO src/ > result.txt', 'rg TODO src/\nrg ERROR src/'])('does not infer output ownership for %s', command => {
    const stdout = `IMPORTANT: preserve this diagnostic\n${matches}`
    expect(grepFilter.project({ command, stdout, exitCode: 0 }) ?? stdout).toBe(stdout)
  })

  it('preserves unrecognized lines before search matches', () => {
    const stdout = `IMPORTANT: preserve this diagnostic\n${matches}`
    expect(grepFilter.project({ command: 'rg TODO src/', stdout, exitCode: 0 }) ?? stdout).toBe(stdout)
  })

  it('keeps errors in a terse pytest summary', () => {
    const stdout = '================ test session starts ================\ncollected 2 items\ntests/test_a.py .E\n================ 1 passed, 1 error in 0.05s ================\n'
    const result = pytestFilter.project({ command: 'pytest --tb=no -rN', stdout, exitCode: 1 }) ?? stdout
    expect(result).toContain('1 error')
  })

  it('does not invent success after an interrupted pytest run', () => {
    const stdout = '================ 3 passed in 0.05s ================\nFATAL: wrapper failed\n'
    expect(pytestFilter.project({ command: 'pytest', stdout, exitCode: 2 }) ?? stdout).toBe(stdout)
  })

  it('preserves every detail in pytest failure and warning sections', () => {
    const stdout = '================ test session starts ================\ncollected 2 items\n================ FAILURES ================\n_____ test_bad _____\nfixture context needed for repair\nE AssertionError\n================ warnings summary ================\nWARNING: deprecated fixture reward_cfg\n================ short test summary info ================\nFAILED tests/test_a.py::test_bad - AssertionError\n================ 1 failed, 1 passed, 1 warning in 0.05s ================\n'
    const result = pytestFilter.project({ command: 'pytest', stdout, exitCode: 1 }) ?? stdout
    expect(result).toContain('fixture context needed for repair')
    expect(result).toContain('WARNING: deprecated fixture reward_cfg')
  })

  it('preserves metadata-only git changes', () => {
    const stdout = 'diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n'
    expect(gitDiffFilter.project({ command: 'git diff', stdout, exitCode: 0 }) ?? stdout).toContain('new mode 100755')
  })
})
