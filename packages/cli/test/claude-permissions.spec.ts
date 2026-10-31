import { describe, expect, it } from 'vitest'
import { ruleMatches, simpleCommand } from '../src/claude-permissions.ts'

describe('Claude Code permission rules', () => {
  it('match Bash rules the way Claude Code writes them', () => {
    expect(ruleMatches('Bash', 'pytest -q')).toBe(true)
    expect(ruleMatches('Bash(*)', 'pytest -q')).toBe(true)
    expect(ruleMatches('Bash(pytest -q)', 'pytest -q')).toBe(true)
    expect(ruleMatches('Bash(pytest -q)', 'pytest -q -x')).toBe(false)
    expect(ruleMatches('Bash(python3 -m pytest:*)', 'python3 -m pytest -v')).toBe(true)
    expect(ruleMatches('Bash(python3 -m pytest:*)', 'python3 -m pytest')).toBe(true)
    expect(ruleMatches('Bash(python3 -m pytest:*)', 'python3 -m pytestx')).toBe(false)
    expect(ruleMatches('Bash(git * main)', 'git push origin main')).toBe(true)
    expect(ruleMatches('Read(./src/**)', 'pytest')).toBe(false)
    expect(ruleMatches('Bash(a:*:*)', 'pytest')).toBeUndefined()
  })

  it('err toward a match for deny and ask rules', () => {
    expect(ruleMatches('Bash(rm:*)', 'rmdir x', true)).toBe(true)
    expect(ruleMatches('Bash(git push)', 'git push --force', true)).toBe(true)
    expect(ruleMatches('Bash(rm:*)', 'rmdir x')).toBe(false)
  })

  it('treat only one command without operators as simple', () => {
    for (const command of ['pytest -q', 'grep -rn "a b" src', 'CI=1 uv run pytest', 'python3 -m pytest -v 2>&1']) expect(simpleCommand(command), command).toBe(true)
    for (const command of ['a && b', 'a | b', 'a; b', 'a > f', 'echo $(x)', 'echo `x`', 'a\nb', '', 'a 2>&1 | tee f', 'a > f 2>&1']) expect(simpleCommand(command), command).toBe(false)
  })
})
