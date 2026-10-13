import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { MechanismMode } from '@lightcode/protocol'
import { createDshEconomy } from '../src/economy.ts'
import type { PostToolDecision, ToolExecution } from '../src/host.ts'
import { bashResult, pytestOutput } from './render.ts'

const dirs: string[] = []
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'lightcode-dsh-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const accept: PostToolDecision = { kind: 'accept' }
const exec = (command: string, extra: Partial<ToolExecution> = {}): ToolExecution =>
  ({ callId: 'call-1', name: 'bash', arguments: { command, description: 'run' }, agent: { session: { id: 'session-1', header: { cwd: '/nowhere' } } }, ...extra })

function setup(mode: MechanismMode = 'apply', env: NodeJS.ProcessEnv = {}) {
  const dataDir = temp()
  const warnings: string[] = []
  let current = mode
  const economy = createDshEconomy({ mode: () => current, dataDir, env, warn: message => warnings.push(message) })
  const journal = () => {
    const dir = join(dataDir, 'journal', 'dsh')
    try {
      return readdirSync(dir).flatMap(name => readFileSync(join(dir, name), 'utf8').trim().split('\n').map(line => JSON.parse(line)))
    } catch { return [] }
  }
  return { economy, dataDir, warnings, journal, setMode: (next: MechanismMode) => { current = next } }
}

const text = (decision: PostToolDecision) => (decision as { content?: { text: string }[] }).content?.[0]?.text

describe('DSH Token Economy', () => {
  it('replaces recognized output, keeps every marker, and journals the original', () => {
    const { economy, journal, dataDir } = setup()
    const result = bashResult({ stdout: pytestOutput(40, 2), stderr: 'DeprecationWarning: x\n', exitCode: 1 })
    const decision = economy.postExecute(exec('python -m pytest -v'), result, accept)
    const projected = text(decision)!
    expect(projected.length).toBeLessThan(result.content[0]!.text.length)
    expect(projected).toContain('FAILED tests/test_inventory.py::test_broken_1')
    expect(projected.endsWith('[stderr]\nDeprecationWarning: x\n[exit code: 1]')).toBe(true)
    const [record] = journal()
    expect(record).toMatchObject({ type: 'economy/decision', host: 'dsh', sessionId: 'session-1', callId: 'call-1', tool: 'bash',
      outcome: 'projected', filter: 'pytest', delivery: 'in-process', streams: 'separate', exitCode: 1 })
    const original = readFileSync(join(dataDir, 'artifacts', record.raw.sha256.slice(0, 2), `${record.raw.sha256}.txt`), 'utf8')
    expect(original).toBe(result.content[0]!.text)
  })
  it('only records in observe mode and does nothing when off', () => {
    const { economy, journal, setMode } = setup('observe')
    const result = bashResult({ stdout: pytestOutput(60) })
    expect(economy.postExecute(exec('pytest -v'), result, accept)).toBe(accept)
    expect(journal()).toMatchObject([{ outcome: 'previewed', mode: 'observe' }])
    setMode('off')
    expect(economy.postExecute(exec('pytest -v'), result, accept)).toBe(accept)
    expect(journal()).toHaveLength(1)
  })
  it('follows the live mode setting from one call to the next', () => {
    const { economy, setMode } = setup('off')
    const result = bashResult({ stdout: pytestOutput(60) })
    expect(text(economy.postExecute(exec('pytest -v'), result, accept))).toBeUndefined()
    setMode('apply')
    expect(text(economy.postExecute(exec('pytest -v'), result, accept))).toContain('60 passed')
  })
  it('lets LightCode configuration and environment lower the plugin setting, never raise it', () => {
    const result = bashResult({ stdout: pytestOutput(60) })
    const configured = setup('apply')
    writeFileSync(join(configured.dataDir, 'config.json'), JSON.stringify({ economy: { mode: 'observe' } }))
    expect(configured.economy.postExecute(exec('pytest -v'), result, accept)).toBe(accept)
    expect(configured.journal()).toMatchObject([{ outcome: 'previewed' }])
    for (const env of [{ LIGHTCODE_DISABLE: '1' }, { LIGHTCODE_ECONOMY: 'off' }]) {
      const disabled = setup('apply', env)
      expect(disabled.economy.postExecute(exec('pytest -v'), result, accept)).toBe(accept)
      expect(disabled.journal()).toEqual([])
    }
    const project = setup('observe')
    const cwd = temp()
    mkdirSync(join(cwd, '.lightcode'))
    writeFileSync(join(cwd, '.lightcode', 'config.json'), JSON.stringify({ economy: { mode: 'apply' } }))
    const inProject = exec('pytest -v', { agent: { session: { id: 's2', header: { cwd } } } })
    expect(project.economy.postExecute(inProject, result, accept)).toBe(accept)
  })
  it('turns itself off on a broken configuration instead of guessing', () => {
    const { economy, dataDir, journal } = setup('apply')
    writeFileSync(join(dataDir, 'config.json'), '{ not json')
    expect(economy.postExecute(exec('pytest -v'), bashResult({ stdout: pytestOutput(60) }), accept)).toBe(accept)
    expect(journal()).toEqual([])
    expect(economy.report({ id: 'session-1', cwd: '/nowhere' })).toContain('config problem')
  })
  it('projects a Cargo build report kept on stderr', () => {
    const { economy } = setup()
    const compiling = Array.from({ length: 40 }, (_, i) => `   Compiling crate${i} v0.1.${i}`).join('\n')
    const stderr = `${compiling}\n    Finished \`dev\` profile [unoptimized + debuginfo] target(s) in 4.20s\n`
    const result = bashResult({ stdout: '', stderr })
    const projected = text(economy.postExecute(exec('cargo build'), result, accept))
    expect(projected).toBeDefined()
    expect(projected!.startsWith('[stderr]\n')).toBe(true)
    expect(projected).toContain('Finished')
  })
  it('leaves everything else alone', () => {
    const { economy, journal } = setup()
    const result = bashResult({ stdout: pytestOutput(60) })
    const cases: [ToolExecution, Parameters<typeof economy.postExecute>[1], PostToolDecision][] = [
      [exec('pytest -v', { name: 'pwsh' }), result, accept],
      [exec('pytest -v', { parent: 'run_code-token' }), result, accept],
      [exec('pytest -v'), { isError: true, content: result.content }, accept],
      [exec('pytest -v'), result, { kind: 'block', feedback: [{ type: 'text', text: 'no' }] }],
      [exec('pytest -v'), result, { kind: 'accept', value: { replaced: true } }],
      [exec('pytest -v'), result, { kind: 'accept', content: [{ type: 'text', text: 'already rewritten by another plugin' }] }],
      [exec('pytest -v'), bashResult({ stdout: pytestOutput(60), stdoutTruncated: true }), accept],
      [exec('pytest -v'), bashResult({ stdout: pytestOutput(60), exitCode: null, signal: 'SIGTERM' }), accept],
      [exec('echo hello'), bashResult({ stdout: 'hello\n' }), accept],
    ]
    for (const [call, outcome, decision] of cases) expect(economy.postExecute(call, outcome, decision)).toBe(decision)
    expect(journal().every(record => record.outcome === 'passed')).toBe(true)
  })
  it('keeps contexts another listener attached', () => {
    const { economy } = setup()
    const additionalContexts = [{ role: 'user', content: [{ type: 'text', text: 'note' }] }]
    const decision = economy.postExecute(exec('pytest -v'), bashResult({ stdout: pytestOutput(60) }), { kind: 'accept', additionalContexts })
    expect(decision).toMatchObject({ kind: 'accept', additionalContexts })
    expect(text(decision)).toContain('60 passed')
  })
  it('delivers the original when the private store cannot be written', () => {
    const blocked = join(temp(), 'file')
    writeFileSync(blocked, '')
    const warnings: string[] = []
    const economy = createDshEconomy({ mode: () => 'apply', dataDir: join(blocked, 'home'), env: {}, warn: message => warnings.push(message) })
    expect(economy.postExecute(exec('pytest -v'), bashResult({ stdout: pytestOutput(60) }), accept)).toEqual(accept)
    expect(economy.postExecute(exec('pytest -v'), bashResult({ stdout: pytestOutput(60) }), accept)).toEqual(accept)
    // Each distinct problem is reported once, not once per tool call.
    expect(warnings.length).toBeGreaterThan(0)
    expect(new Set(warnings).size).toBe(warnings.length)
  })
  it('touches nothing on disk while off, /lightcode included', () => {
    const home = join(temp(), 'lightcode')
    const economy = createDshEconomy({ mode: () => 'off', dataDir: home, env: {} })
    expect(economy.postExecute(exec('pytest -v'), bashResult({ stdout: pytestOutput(60) }), accept)).toBe(accept)
    expect(economy.report({ id: 'session-1' })).toContain('economy: off')
    expect(existsSync(home)).toBe(false)
  })
  it('passes the original when even the projection is over DSH\'s inline budget, so DSH spills the complete text', () => {
    const dataDir = temp()
    const economy = createDshEconomy({ mode: () => 'apply', inlineLimitChars: 200, dataDir, env: {} })
    const result = bashResult({ stdout: pytestOutput(40, 2), exitCode: 1 })
    expect(economy.postExecute(exec('pytest -v'), result, accept)).toBe(accept)
    const roomy = createDshEconomy({ mode: () => 'apply', inlineLimitChars: 100_000, dataDir, env: {} })
    expect(text(roomy.postExecute(exec('pytest -v'), result, accept))).toContain('2 failed')
    const records = readdirSync(join(dataDir, 'journal', 'dsh')).flatMap(name => readFileSync(join(dataDir, 'journal', 'dsh', name), 'utf8').trim().split('\n').map(line => JSON.parse(line)))
    expect(records.map(record => [record.outcome, record.reason])).toEqual([['passed', 'over-host-inline-limit'], ['projected', undefined]])
  })
  it('picks up a changed configuration file without a restart', async () => {
    const { economy, dataDir, journal } = setup('apply')
    const result = bashResult({ stdout: pytestOutput(60) })
    expect(text(economy.postExecute(exec('pytest -v'), result, accept))).toContain('60 passed')
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify({ economy: { mode: 'observe' } }))
    expect(economy.postExecute(exec('pytest -v'), result, accept)).toBe(accept)
    expect(journal().map(record => record.outcome)).toEqual(['projected', 'previewed'])
    rmSync(join(dataDir, 'config.json'))
    expect(text(economy.postExecute(exec('pytest -v'), result, accept))).toContain('60 passed')
  })
  it('never throws, whatever the harness hands it', () => {
    const { economy } = setup()
    const hostile = { get name(): string { throw new Error('boom') } } as unknown as ToolExecution
    expect(economy.postExecute(hostile, bashResult({ stdout: 'x' }), accept)).toBe(accept)
    const throwingMode = createDshEconomy({ mode: () => { throw new Error('volatile gone') }, dataDir: temp(), env: {} })
    expect(throwingMode.postExecute(exec('pytest -v'), bashResult({ stdout: pytestOutput(60) }), accept)).toBe(accept)
  })
  it('reports savings and negotiation for /lightcode', () => {
    const { economy } = setup()
    expect(economy.report({ id: 'session-1' })).toContain('has not filtered any output')
    economy.postExecute(exec('pytest -v'), bashResult({ stdout: pytestOutput(60) }), accept)
    const report = economy.report({ id: 'session-1' })
    expect(report).toMatch(/LightCode saved ~\S+ tokens in this session \(1 of 1 outputs filtered\)/)
    expect(report).toContain('pytest: 1×')
    expect(report).toContain('economy: apply')
    expect(report).toContain('command-normalization: off')
    expect(economy.negotiated()[0]).toMatchObject({ mechanism: 'economy', mode: 'apply' })
  })
})
