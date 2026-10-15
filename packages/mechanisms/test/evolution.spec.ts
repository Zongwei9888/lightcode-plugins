import { describe, expect, it } from 'vitest'
import { compileLearnedRules, createPolicy, sha256 } from '@lightcode-ai/core'
import type { ArtifactPort, EconomyRecord } from '@lightcode-ai/protocol'
import { checkRequirements, collectEvidence, commandHead, defaultRequirements, verifyRules } from '../src/index.ts'

const artifacts = (texts: string[]): ArtifactPort => {
  const map = new Map(texts.map(text => [sha256(text), text]))
  return { save: () => { throw new Error('read-only') }, read: hash => map.get(hash) }
}
const record = (command: string, rendered: string, extra: Partial<EconomyRecord> = {}): EconomyRecord => ({
  schemaVersion: 1, type: 'economy/decision', time: '2026-10-14T00:00:00.000Z', host: 'pi', sessionId: 's', callId: 'c', tool: 'bash', command, exitCode: 0,
  delivery: 'in-process', streams: 'merged', mode: 'apply', outcome: 'passed', reason: 'no-filter-match', runtimeVersion: 'v', policyHash: 'p',
  raw: { sha256: sha256(rendered), bytes: rendered.length, tokens: Math.ceil(rendered.length / 4), stored: true },
  layout: { stdout: { start: 0, length: rendered.length } }, ...extra,
})
const progress = Array.from({ length: 50 }, (_, i) => `[${i + 1}/50] step ${i}`).join('\n') + '\nok\n'
const rule = (body: string) => compileLearnedRules([
  { path: 'index.json', text: JSON.stringify({ schemaVersion: 1, rules: [{ id: 'r', file: 'rules/r.js' }] }) },
  { path: 'rules/r.js', text: `defineRule({ project(input, lc) { ${body} } })` },
])

describe('evolution', () => {
  it('the built-in filters meet every preservation requirement', () => {
    const result = checkRequirements(createPolicy(), defaultRequirements())
    expect(result.results.filter(item => !item.passed)).toEqual([])
  })

  it('rebuilds evidence from the journal: stored, complete shell output only, identical observations once', () => {
    const records = [
      record('./steps', progress), record('./steps', progress),
      record('./steps', progress, { layout: { stdout: { start: 0, length: progress.length }, truncated: true } }),
      record('./other', 'gone\n'.repeat(50)),
      record('./unstored', progress, { raw: { sha256: sha256(progress), bytes: 1, tokens: 1, stored: false } }),
      (({ layout: _layout, ...rest }) => ({ ...rest, exitCode: null }))(record('grep {}', 'x')),
    ]
    const cases = collectEvidence(records, artifacts([progress]))
    expect(cases).toHaveLength(1)
    expect(cases[0]).toMatchObject({ occurrences: 2, result: { command: './steps', rendered: progress, stdout: { start: 0, text: progress } } })
    expect(collectEvidence(records, artifacts([progress]), { since: new Date('2026-10-15') })).toEqual([])
  })

  it('accepts a gain without regressions, and names why it rejects', () => {
    const cases = collectEvidence([record('./steps', progress)], artifacts([progress]))
    const good = rule("return input.argv && input.argv[0] === './steps' ? lc.keepLines(input.raw, line => !/^\\[\\d+\\/\\d+\\]/.test(line.text)) : null")
    expect(verifyRules({ parent: undefined, candidate: good, cases })).toMatchObject({ accepted: true, improved: 1, reasons: [] })
    expect(verifyRules({ parent: good, candidate: good, cases })).toMatchObject({ accepted: false, reasons: ['unchanged', 'no-incremental-token-gain'] })
    const regression = verifyRules({ parent: good, candidate: undefined, cases })
    expect(regression).toMatchObject({ accepted: false, reasons: ['no-incremental-token-gain', 'replay-token-regression'] })
    const lossy = rule("return input.argv && input.argv[0] === 'cat' ? lc.keepLines(input.raw, line => line.text !== '') : null")
    expect(verifyRules({ parent: undefined, candidate: lossy, cases })).toMatchObject({ accepted: false,
      reasons: expect.arrayContaining(['preservation-requirement-failed']) })
    // Removing a rule that broke a requirement is a repair, even without a gain.
    expect(verifyRules({ parent: lossy, candidate: undefined, cases })).toMatchObject({ accepted: true, changeKind: 'safety-repair' })
    const throws = rule("throw new Error('x')")
    expect(verifyRules({ parent: undefined, candidate: throws, cases })).toMatchObject({ accepted: false, reasons: expect.arrayContaining(['rule-error']), ruleFailures: { r: expect.any(Number) } })
  })

  it('rejects a rule that only fits the observations the learner saw, judging each command on its own', () => {
    const output = (seed: string) => Array.from({ length: 50 }, (_, i) => `[${i + 1}/50] step ${i} ${seed}`).join('\n') + '\nok\n'
    const a = output('alpha'), b = output('beta')
    const cases = collectEvidence([record('./steps', a), record('./steps', b, { time: '2026-10-13T00:00:00.000Z' })], artifacts([a, b]))
    const heldOut = new Set([cases.find(item => item.result.rendered === b)!.id])
    const general = rule("return input.argv && input.argv[0] === './steps' ? lc.keepLines(input.raw, line => !/^\\[\\d+\\/\\d+\\]/.test(line.text)) : null")
    expect(verifyRules({ parent: undefined, candidate: general, cases, heldOut })).toMatchObject({ accepted: true,
      generalization: { status: 'confirmed', commands: ['./steps'], heldOutCases: 1 } })
    // Matches the sample it saw, word for word.
    const memorized = rule("return input.raw.includes('alpha') ? lc.keepLines(input.raw, line => !/^\\[\\d+\\/\\d+\\]/.test(line.text)) : null")
    expect(verifyRules({ parent: undefined, candidate: memorized, cases, heldOut })).toMatchObject({ accepted: false, reasons: ['did-not-generalize'],
      generalization: { status: 'failed', heldOutGain: 0 } })
    // With nothing held out of that command, generalization is untested, not failed.
    expect(verifyRules({ parent: undefined, candidate: memorized, cases, heldOut: new Set() }))
      .toMatchObject({ accepted: true, generalization: { status: 'untested' } })
    // One command that generalizes does not hide another that only fits its samples.
    const c = output('gamma').replace(/step/gu, 'pass'), d = output('delta').replace(/step/gu, 'pass')
    const both = collectEvidence([record('./steps', a), record('./steps', b, { time: '2026-10-13T00:00:00.000Z' }),
      record('./other', c, { time: '2026-10-12T00:00:00.000Z' }), record('./other', d, { time: '2026-10-11T00:00:00.000Z' })], artifacts([a, b, c, d]))
    const mixed = rule("if (!input.argv) return null; if (input.argv[0] === './steps' || input.raw.includes('gamma')) return lc.keepLines(input.raw, line => !/^\\[\\d+\\/\\d+\\]/.test(line.text)); return null")
    const held = new Set(both.filter(item => item.result.rendered === b || item.result.rendered === d).map(item => item.id))
    expect(verifyRules({ parent: undefined, candidate: mixed, cases: both, heldOut: held })).toMatchObject({ accepted: false, reasons: ['did-not-generalize'],
      generalization: { status: 'failed', byCommand: [{ command: './other', heldOutGain: 0 }, { command: './steps', heldOutCases: 1 }] } })
  })

  it('groups commands by tool and subcommand', () => {
    expect(['npm install', 'npm test -- -u', 'pytest -v', 'python3 app.py', 'git diff --stat', './build.sh', 'cargo test --release'].map(commandHead))
      .toEqual(['npm install', 'npm test', 'pytest', 'python3', 'git diff', './build.sh', 'cargo test'])
    // What agents really run: a cd, pipes, assignments, setup commands.
    expect([
      'cd /tmp/work && python3 -m pytest -v 2>&1 | tail -15',
      'cd packages/x/src; grep -n "a\\|b" index.ts | head -20',
      'cd "/some dir" && FOO=1 cargo test --release',
      'export CI=1 && npx jest --silent',
      'source .venv/bin/activate; python app.py',
      'cat file.txt | grep x',
      'cd src',
    ].map(commandHead)).toEqual(['python3 -m pytest', 'grep', 'cargo test', 'jest', 'python', 'cat', 'cd src'])
  })
})
