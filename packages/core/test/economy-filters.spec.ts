import { describe, expect, it } from 'vitest'
import { gitDiffFilter, grepFilter, pytestFilter } from '../src/filters/index.ts'

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
})
