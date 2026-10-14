import { describe, expect, it } from 'vitest'
import { compileLearnedRules, createPolicy, decideShellProjection, parseRuleIndex, ruleDirectoryHash, RuleDirectoryError } from '../src/index.ts'
import type { RuleFile } from '../src/index.ts'

const index = (rules: { id: string; file?: string; transformation?: string }[]) =>
  ({ path: 'index.json', text: JSON.stringify({ schemaVersion: 1, rules: rules.map(rule => ({ file: `rules/${rule.id}.js`, ...rule })) }) })
const rule = (id: string, body: string): RuleFile => ({ path: `rules/${id}.js`, text: body })

/** Drops a project build script's progress lines ("[ 12%] Building ...") and keeps everything else. */
const MAKE_PROGRESS = `defineRule({
  project(input, lc) {
    if (!input.argv || input.argv[0] !== './build.sh') return null
    return lc.keepLines(input.raw, line => !/^\\[\\s*\\d+%\\] (Building|Linking)/.test(line.text),
      omitted => '[' + omitted + ' make progress lines omitted]\\n')
  },
})`
const makeOutput = Array.from({ length: 60 }, (_, i) => `[ ${String(i).padStart(2)}%] Building CXX object src/CMakeFiles/app.dir/file${i}.cpp.o`).join('\n')
  + '\n[100%] Built target app\n'
const shell = (command: string, stdout: string, exitCode = 0) => ({ command, exitCode, rendered: stdout, stdout: { start: 0, text: stdout } })

describe('learned rules', () => {
  it('runs a learned rule before the built-in filters, with an exact source map', () => {
    const files = [index([{ id: 'make-progress', transformation: 'noise-removal' }]), rule('make-progress', MAKE_PROGRESS)]
    const learned = compileLearnedRules(files)
    expect(learned.hash).toBe(ruleDirectoryHash(files))
    const policy = createPolicy(undefined, learned)
    expect(policy.learnedRulesHash).toBe(learned.hash)
    expect(policy.policyHash).not.toBe(createPolicy().policyHash)
    const decision = decideShellProjection(shell('./build.sh -j8', makeOutput), { policy })
    expect(decision).toMatchObject({ kind: 'project', filter: 'learned-rule', rule: 'make-progress', transformation: 'noise-removal' })
    if (decision.kind !== 'project') return
    expect(decision.text).toBe('[100%] Built target app\n[60 make progress lines omitted]\n')
    // Without the rule nothing recognizes the script's output.
    expect(decideShellProjection(shell('./build.sh -j8', makeOutput), { policy: createPolicy() })).toMatchObject({ kind: 'pass', reason: 'no-filter-match' })
    // Other commands go on to the built-in filters.
    const grep = Array.from({ length: 80 }, (_, i) => `src/a.ts:${i + 1}:const value${i} = ${i}`).join('\n') + '\n'
    expect(decideShellProjection(shell('grep -rn value src', grep), { policy })).toMatchObject({ kind: 'project', filter: 'grep' })
  })

  it('abstains when a rule drops a diagnostic line, returns a bad source map, or fails', () => {
    const output = `${makeOutput}src/x.cpp:3: warning: unused variable\n`
    const dropsAll = rule('drops', `defineRule({ project(input, lc) { return lc.keepLines(input.raw, line => /Built target/.test(line.text)) } })`)
    const learned = compileLearnedRules([index([{ id: 'drops' }]), dropsAll])
    expect(learned.project({ command: './build.sh', stdout: output, exitCode: 0 })).toBeUndefined()
    expect(learned.project({ command: './build.sh', stdout: makeOutput, exitCode: 0 })?.text).toBe('[100%] Built target app\n[60 lines omitted]\n')

    const forged = rule('forged', `defineRule({ project(input) { return { text: 'x', sourceMap: { version: 1, unit: 'utf16', sourceLength: input.raw.length, outputLength: 1,
      spans: [{ outputStart: 0, outputEnd: 1, sourceStart: 0, sourceEnd: 1 }] } } } })`)
    const throws = rule('throws', `defineRule({ project() { throw new Error('boom') } })`)
    const loops = rule('loops', `defineRule({ project() { for (;;) {} } })`)
    const set = compileLearnedRules([index([{ id: 'forged' }, { id: 'throws' }, { id: 'loops' }]), forged, throws, loops], { timeoutMs: 20 })
    expect(set.project({ command: 'make', stdout: makeOutput, exitCode: 0 })).toBeUndefined()
    expect(Object.fromEntries(set.failures)).toEqual({ forged: 1, throws: 1, loops: 1 })
    // The rule set keeps working after a timeout.
    expect(set.project({ command: 'make', stdout: makeOutput, exitCode: 0 })).toBeUndefined()
  })

  it('gives rule code nothing of the host', () => {
    // The global's constructor chain ends in the context's own Function, which cannot compile strings either.
    const probes = ['typeof process', 'typeof require', 'typeof globalThis.process', 'typeof setTimeout', 'typeof fetch', 'typeof Buffer',
      "(() => { try { return globalThis.constructor.constructor('return typeof process')() } catch (e) { return 'blocked' } })()"]
    const files = [index([{ id: 'probe' }]), rule('probe', `defineRule({ project(input, lc) {
      const b = lc.builder(input.raw)
      b.generate([${probes.join(', ')}].join(',') + '|' + (() => { try { return eval('1') } catch (e) { return 'no-eval' } })()
        + '|' + (() => { try { return Function('return 1')() } catch (e) { return 'no-function' } })(), 'probe')
      return b.finish()
    } })`)]
    const result = compileLearnedRules(files).project({ command: 'x', stdout: 'y'.repeat(100), exitCode: 0 })
    expect(result?.text).toBe('undefined,undefined,undefined,undefined,undefined,undefined,blocked|no-eval|no-function')
  })

  it('rejects malformed directories', () => {
    expect(() => compileLearnedRules([])).toThrow(RuleDirectoryError)
    expect(() => parseRuleIndex([{ path: 'index.json', text: '{"schemaVersion":2,"rules":[]}' }])).toThrow(/schemaVersion/)
    expect(() => parseRuleIndex([index([{ id: 'Bad Id' }])])).toThrow(/id must match/)
    expect(() => parseRuleIndex([index([{ id: 'a' }, { id: 'a' }]), rule('a', '')])).toThrow(/duplicate/)
    expect(() => parseRuleIndex([index([{ id: 'a', file: '../a.js' }])])).toThrow(/rules\/<name>\.js/)
    expect(() => parseRuleIndex([index([{ id: 'a' }])])).toThrow(/missing/)
    expect(() => parseRuleIndex([index([{ id: 'a', transformation: 'summary' }]), rule('a', '')])).toThrow(/transformation/)
    expect(() => compileLearnedRules([index([{ id: 'a' }]), rule('a', '/* never calls defineRule */')])).toThrow(/did not call defineRule/)
    expect(() => compileLearnedRules([index([{ id: 'a' }]), rule('a', 'syntax error here')])).toThrow(/loading rules failed/)
    expect(() => compileLearnedRules([index([{ id: 'a' }]), rule('a', 'for (;;) {}')], { timeoutMs: 20 })).toThrow(/loading rules failed/)
  })

  it('hashes the directory by content, independent of file order', () => {
    const a = [index([{ id: 'make-progress' }]), rule('make-progress', MAKE_PROGRESS)]
    expect(ruleDirectoryHash(a)).toBe(ruleDirectoryHash([...a].reverse()))
    expect(ruleDirectoryHash(a)).not.toBe(ruleDirectoryHash([a[0]!, rule('make-progress', `${MAKE_PROGRESS}\n`)]))
  })
})
