import { describe, expect, it } from 'vitest'
import { gitDiffFilter, gitShowFilter, grepFilter, pytestFilter } from '../src/filters/index.ts'

describe('Token Economy static filter parity', () => {
  it('keeps pytest failure identity and relevant diagnostics', () => {
    const stdout = `============================= test session starts ==============================
collected 3 items

tests/test_foo.py ..F [100%]

=================================== FAILURES ===================================
___________________________________ test_bad ___________________________________
>       assert 1 == 2
E       assert 1 == 2
tests/test_foo.py:10: AssertionError
=========================== short test summary info ============================
FAILED tests/test_foo.py::test_bad - assert 1 == 2
========================= 1 failed, 2 passed in 0.05s ==========================
`
    const projected = pytestFilter.project({ command: 'cd /repo && python -m pytest -q', stdout, exitCode: 1 })
    expect(pytestFilter.project({ command: 'cd /repo && python -m pytest -q 2>&1', stdout, exitCode: 1 })).toBe(projected)
    // A program named by its path reads as the tool it runs (a virtualenv, Homebrew).
    for (const command of ['.venv/bin/python -m pytest -q', '/opt/homebrew/bin/python3 -m pytest -q', 'cd /repo && .venv/bin/pytest -q 2>&1']) {
      expect(pytestFilter.project({ command, stdout, exitCode: 1 })).toBe(projected)
    }
    // So does a program a runner starts (as RTK and snip do), and one behind `time` or variable assignments.
    for (const command of ['uv run pytest -q', 'poetry run pytest -q', 'pipenv run pytest -q', 'pdm run pytest -q', 'time pytest -q', 'CI=1 pytest -q',
      'CI=1 uv run python -m pytest -q', 'cd /repo && uv run .venv/bin/pytest -q 2>&1']) {
      expect(pytestFilter.project({ command, stdout, exitCode: 1 }), command).toBe(projected)
    }
    // A runner option means another program shape: left alone.
    expect(pytestFilter.project({ command: 'uv run --with pytest-xdist pytest -q', stdout, exitCode: 1 })).toBeUndefined()
    expect(projected).toContain('test_bad')
    expect(projected).toContain('assert 1 == 2')
    expect(projected?.length).toBeLessThan(stdout.length)
  })

  it('caps grep matches per file without dropping file identity', () => {
    const stdout = [
      ...Array.from({ length: 28 }, (_, index) => `foo.py:${index + 1}: match`),
      ...Array.from({ length: 3 }, (_, index) => `bar.py:${index + 1}: result`),
    ].join('\n')
    const projected = grepFilter.project({ command: 'cd /repo && rg TODO src/', stdout, exitCode: 0 })
    expect(projected?.match(/^foo\.py:/gm)).toHaveLength(25)
    expect(projected).toContain('3 more matches in foo.py')
    expect(projected).toContain('bar.py')
  })

  it('caps a large diff while retaining file, hunk, and change counts', () => {
    const additions = Array.from({ length: 200 }, (_, index) => `+line${index}`).join('\n')
    const stdout = `diff --git a/foo.py b/foo.py
index abc..def 100644
--- a/foo.py
+++ b/foo.py
@@ -0,0 +1,200 @@ def foo():
${additions}
`
    const projected = gitDiffFilter.project({ command: 'git diff HEAD~1', stdout, exitCode: 0 })
    expect(projected).toContain('foo.py')
    expect(projected).toContain('def foo')
    expect(projected).toContain('lines truncated')
    expect(projected).toContain('+200 -0')
    expect(projected).toContain('+line199')
  })

  it('previews oversized hunks of git show and git log -p, keeping every commit header and message', () => {
    const hunk = (file: string) => [`diff --git a/${file} b/${file}`, 'index 1111111..2222222 100644', `--- a/${file}`, `+++ b/${file}`, '@@ -1,150 +1,150 @@',
      ...Array.from({ length: 150 }, (_, i) => i % 2 ? `-old line ${i}` : `+new line ${i}`), ...Array.from({ length: 75 }, (_, i) => ` context ${i}`)].join('\n')
    const fix = 'Fix rounding in to_cents\n\nThe export expects half-up rounding.'
    const commit = (sha: string, message: string, file: string) => [`commit ${sha}`, 'Author: Dana Lee <dana@example.com>', 'Date:   Tue Jul 1 09:15:00 2026 +0000', '',
      ...message.split('\n').map(line => line ? `    ${line}` : ''), '', hunk(file)].join('\n')
    const show = commit('5cac6a1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b', fix, 'ledger/money.py') + '\n'
    const projected = gitShowFilter.project({ command: 'git show 5cac6a1', stdout: show, exitCode: 0 })!
    expect(projected.length).toBeLessThan(show.length)
    for (const kept of ['commit 5cac6a1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b', 'Author: Dana Lee', '    Fix rounding in to_cents', '    The export expects half-up rounding.',
      'diff --git a/ledger/money.py b/ledger/money.py', '@@ -1,150 +1,150 @@', '  +75 -75', 'lines truncated']) expect(projected, kept).toContain(kept)
    // git log -p: several commits, each header kept; a decorated header too.
    const log = [commit('aaaaaaa1111111111111111111111111111111111 (HEAD -> main)', 'Second change', 'b.py'), commit('bbbbbbb2222222222222222222222222222222222', 'First change', 'a.py')].join('\n') + '\n'
    const logged = gitShowFilter.project({ command: 'git log -p -2', stdout: log, exitCode: 0 })!
    for (const kept of ['commit aaaaaaa1111111111111111111111111111111111 (HEAD -> main)', '    Second change', 'commit bbbbbbb2222222222222222222222222222222222', '    First change']) expect(logged).toContain(kept)
    // Other layouts, merge diffs, file contents and plain git log pass through.
    for (const command of ['git show --stat 5cac6a1', 'git show --format=%H 5cac6a1', 'git log -2', 'git log --oneline -p']) {
      expect(gitShowFilter.project({ command, stdout: show, exitCode: 0 }), command).toBeUndefined()
    }
    expect(gitShowFilter.project({ command: 'git show HEAD:ledger/money.py', stdout: 'def to_cents(x):\n    return x\n', exitCode: 0 })).toBeUndefined()
    expect(gitShowFilter.project({ command: 'git show 5cac6a1', stdout: show.replace('diff --git a/ledger/money.py b/ledger/money.py', 'diff --cc ledger/money.py'), exitCode: 0 })).toBeUndefined()
  })
})
