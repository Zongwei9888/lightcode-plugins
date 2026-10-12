import { describe, expect, it } from 'vitest'
import { sha256 } from '@lightcode/core'
import type { ArtifactPort, ArtifactRef, JournalRecord } from '@lightcode/protocol'
import { DEFAULT_CONFIG } from '@lightcode/store'
import { EconomyEngine, normalizeShellCommand, summarizeEconomy } from '../src/index.ts'
import type { EconomyEngineOptions } from '../src/index.ts'

class MemoryArtifacts implements ArtifactPort {
  readonly items = new Map<string, string>()
  fail = false
  save(text: string): ArtifactRef {
    if (this.fail) throw new Error('disk full')
    this.items.set(sha256(text), text)
    return { sha256: sha256(text), bytes: Buffer.byteLength(text) }
  }
  read(hash: string) { return this.items.get(hash) }
}

const grep = (n: number) => Array.from({ length: n }, (_, i) => `src/a.ts:${i + 1}:const value${i} = ${i}`).join('\n') + '\n'
const shell = (command: string, stdout: string) => ({ command, exitCode: 0, rendered: stdout, stdout: { start: 0, text: stdout } })

function setup(overrides: Partial<EconomyEngineOptions> = {}) {
  const records: JournalRecord[] = []
  const artifacts = new MemoryArtifacts()
  const engine = new EconomyEngine({ host: 'test', journal: { append: record => { records.push(record) } }, artifacts,
    config: DEFAULT_CONFIG.economy, mode: 'apply', delivery: 'in-process', streams: 'merged', now: () => new Date(0), ...overrides })
  return { engine, records, artifacts }
}

describe('EconomyEngine', () => {
  it('stores the original and source map, journals, then releases the projection', () => {
    const { engine, records, artifacts } = setup()
    const raw = grep(200)
    const output = engine.process({ sessionId: 's', callId: 'c1', tool: 'bash', result: shell('grep -rn value src', raw) })
    expect(output.text).toBeDefined()
    expect(output.text!.length).toBeLessThan(raw.length)
    expect(records).toHaveLength(1)
    const record = records[0]!
    expect(record).toMatchObject({ type: 'economy/decision', outcome: 'projected', filter: 'grep', sessionId: 's', callId: 'c1', delivery: 'in-process' })
    if (record.type !== 'economy/decision') return
    expect(artifacts.read(record.raw!.sha256)).toBe(raw)
    expect(JSON.parse(artifacts.read(record.sourceMap!.sha256)!)).toMatchObject({ version: 1, sourceLength: raw.length })
    expect(record.projected!.sha256).toBe(sha256(output.text!))
  })
  it('records passes without storing the original', () => {
    const { engine, records, artifacts } = setup()
    expect(engine.process({ sessionId: null, callId: null, tool: 'bash', result: shell('my-tool', 'x\n'.repeat(500)) }).text).toBeUndefined()
    expect(records[0]).toMatchObject({ outcome: 'passed', reason: 'no-filter-match', matchDetail: 'command-not-covered', raw: { stored: false } })
    expect(artifacts.items.size).toBe(0)
  })
  it('previews without changing the result in observe mode', () => {
    const { engine, records, artifacts } = setup({ mode: 'observe' })
    expect(engine.process({ sessionId: 's', callId: 'c', tool: 'bash', result: shell('grep -rn value src', grep(200)) }).text).toBeUndefined()
    expect(records[0]).toMatchObject({ outcome: 'previewed', filter: 'grep' })
    expect(artifacts.items.size).toBe(0)
  })
  it('fails open when the original cannot be saved or the decision cannot be journaled', () => {
    const broken = setup()
    broken.artifacts.fail = true
    expect(broken.engine.process({ sessionId: 's', callId: 'c', tool: 'bash', result: shell('grep -rn value src', grep(200)) }).text).toBeUndefined()
    expect(broken.records[0]).toMatchObject({ outcome: 'failed-open', reason: 'artifact-save-failed' })
    const noJournal = setup({ journal: { append: () => { throw new Error('read-only') } } })
    expect(noJournal.engine.process({ sessionId: 's', callId: 'c', tool: 'bash', result: shell('grep -rn value src', grep(200)) }).text).toBeUndefined()
  })
  it('pins one policy per session', () => {
    const { engine } = setup()
    const first = engine.policyFor('s')
    expect(engine.policyFor('s')).toBe(first)
    expect(engine.policyFor('t').policyHash).toBe(first.policyHash)
  })
})

describe('normalizeShellCommand and summaries', () => {
  it('journals rewrites and summarizes savings and uncovered commands', () => {
    const { engine, records } = setup()
    const journal = { append: (record: JournalRecord) => { records.push(record) } }
    expect(normalizeShellCommand({ host: 'test', journal }, { sessionId: 's', callId: 'c', tool: 'bash', command: 'rg value src' })).toBe('rg -n -H value src')
    expect(normalizeShellCommand({ host: 'test', journal }, { sessionId: 's', callId: 'c', tool: 'bash', command: 'ls' })).toBeUndefined()
    engine.process({ sessionId: 's', callId: 'c1', tool: 'bash', result: shell('grep -rn value src', grep(200)) })
    engine.process({ sessionId: 's', callId: 'c2', tool: 'bash', result: shell('terraform-like run', 'y\n'.repeat(100)) })
    engine.process({ sessionId: 's', callId: 'c3', tool: 'bash', result: shell('terraform-like run', 'y\n'.repeat(100)) })
    const summary = summarizeEconomy(records)
    expect(summary).toMatchObject({ decisions: 3, projected: 1, passed: 2, rewrites: 1 })
    expect(summary.savedTokens).toBeGreaterThan(0)
    expect(summary.byFilter[0]).toMatchObject({ filter: 'grep', count: 1 })
    expect(summary.uncovered[0]).toMatchObject({ command: 'terraform-like', count: 2 })
  })
})

describe('prepare and commit', () => {
  it('saves the original at prepare time but journals only on commit', async () => {
    const { isPrepared } = await import('../src/index.ts')
    const { engine, records, artifacts } = setup()
    const prepared = engine.prepare({ sessionId: 's', callId: 'c', tool: 'bash', result: shell('grep -rn value src', grep(200)) })
    expect(isPrepared(prepared)).toBe(true)
    expect(records).toHaveLength(0)
    expect(artifacts.items.size).toBe(2)
    if (!isPrepared(prepared)) return
    expect(engine.commit(prepared).text).toBe(prepared.text)
    expect(records[0]).toMatchObject({ outcome: 'projected', callId: 'c' })
  })
})
