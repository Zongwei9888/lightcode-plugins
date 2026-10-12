import { mkdtempSync, mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileArtifactStore, FileJournal, collectDaily, dataDirs, loadConfig, pathSegment, readJournals, resolveDataDir, writableDataDir } from '../src/index.ts'
import type { EconomyRecord } from '@lightcode/protocol'

const dirs: string[] = []
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'lightcode-store-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const record = (sessionId: string | null, callId: string): EconomyRecord => ({
  schemaVersion: 1, type: 'economy/decision', time: '2026-10-13T00:00:00.000Z', host: 'pi', sessionId, callId,
  tool: 'bash', command: 'grep -rn x .', exitCode: 0, delivery: 'in-process', streams: 'merged', mode: 'apply',
  outcome: 'passed', reason: 'no-filter-match', runtimeVersion: 'static-v10', policyHash: 'p',
})

describe('paths', () => {
  it('honours LIGHTCODE_HOME and hashes unsafe identifiers', () => {
    expect(resolveDataDir({ LIGHTCODE_HOME: '/tmp/x' })).toBe('/tmp/x')
    expect(pathSegment('session-1')).toBe('session-1')
    expect(pathSegment('../escape')).toMatch(/^h-[a-f0-9]{32}$/)
    expect(pathSegment('a/b')).not.toContain('/')
  })
})

describe('data directories', () => {
  it('falls back to a private TMPDIR directory when the primary cannot be written', () => {
    const tmp = temp()
    const blocked = join(temp(), 'file-not-dir')
    writeFileSync(blocked, '')
    const env = { LIGHTCODE_HOME: join(blocked, 'home'), TMPDIR: tmp }
    expect(dataDirs(env)).toEqual([join(blocked, 'home'), join(tmp, `lightcode-${process.getuid!()}`)])
    expect(writableDataDir(env)).toBe(join(tmp, `lightcode-${process.getuid!()}`))
    expect(statSync(writableDataDir(env)!).mode & 0o777).toBe(0o700)
    const ok = temp()
    expect(writableDataDir({ LIGHTCODE_HOME: ok, TMPDIR: tmp })).toBe(ok)
  })
  it('reads journals from every location and filters by session alone', () => {
    const a = temp(), b = temp()
    new FileJournal(a).append(record('s1', 'a'))
    new FileJournal(b).append(record('s2', 'b'))
    expect(readJournals([a, b])).toHaveLength(2)
    expect(readJournals([a, b], { sessionId: 's2' }).map(item => (item as EconomyRecord).callId)).toEqual(['b'])
  })
})

describe('FileArtifactStore', () => {
  it('round-trips originals privately and deduplicates by content', () => {
    const store = new FileArtifactStore(temp())
    const ref = store.save('raw output 中文\n')
    expect(store.save('raw output 中文\n')).toEqual(ref)
    expect(store.read(ref.sha256)).toBe('raw output 中文\n')
    expect(ref.bytes).toBe(Buffer.byteLength('raw output 中文\n'))
    expect(statSync(join(store.root, ref.sha256.slice(0, 2), `${ref.sha256}.txt`)).mode & 0o777).toBe(0o600)
    expect(store.read('not-a-hash')).toBeUndefined()
    expect(store.read('0'.repeat(64))).toBeUndefined()
  })
  it('prunes originals older than the retention period', () => {
    const store = new FileArtifactStore(temp())
    const old = store.save('old')
    const fresh = store.save('fresh')
    const path = join(store.root, old.sha256.slice(0, 2), `${old.sha256}.txt`)
    const past = new Date(Date.now() - 30 * 86_400_000)
    utimesSync(path, past, past)
    expect(store.prune(14)).toBe(1)
    expect(store.read(old.sha256)).toBeUndefined()
    expect(store.read(fresh.sha256)).toBe('fresh')
  })
})

describe('FileJournal', () => {
  it('appends per session and reads back by host and session', () => {
    const journal = new FileJournal(temp())
    journal.append(record('s1', 'a'))
    journal.append(record('s1', 'b'))
    journal.append(record(null, 'c'))
    expect(journal.read({ host: 'pi', sessionId: 's1' }).map(item => (item as EconomyRecord).callId)).toEqual(['a', 'b'])
    expect(journal.read({ host: 'pi' })).toHaveLength(3)
    expect(journal.read()).toHaveLength(3)
    expect(journal.read({ host: 'codex' })).toEqual([])
  })
  it('skips a torn final line', () => {
    const dir = temp()
    const journal = new FileJournal(dir)
    journal.append(record('s', 'a'))
    writeFileSync(journal.fileOf('pi', 's'), '{"schemaVersion":1,"type":"economy/dec', { flag: 'a' })
    expect(journal.read({ host: 'pi', sessionId: 's' })).toHaveLength(1)
  })
})

describe('loadConfig', () => {
  it('uses defaults, then user, project and environment settings', () => {
    const data = temp(), cwd = temp()
    expect(loadConfig({ dataDir: data, env: {} }).config.economy).toMatchObject({ mode: 'apply', minimumSavedTokens: 16 })
    writeFileSync(join(data, 'config.json'), JSON.stringify({ economy: { minimumSavedTokens: 32 }, artifacts: { retentionDays: 3 } }))
    mkdirSync(join(cwd, '.lightcode'))
    writeFileSync(join(cwd, '.lightcode', 'config.json'), JSON.stringify({ economy: { mode: 'observe', filterOptions: { grep: { maxPerFile: 10 } } } }))
    const loaded = loadConfig({ dataDir: data, cwd, env: {} })
    expect(loaded.problems).toEqual([])
    expect(loaded.config).toEqual({ economy: { mode: 'observe', minimumSavedTokens: 32, commandNormalization: true, filterOptions: { grep: { maxPerFile: 10 } } }, artifacts: { retentionDays: 3 } })
    expect(loadConfig({ dataDir: data, cwd, env: { LIGHTCODE_ECONOMY: 'apply' } }).config.economy.mode).toBe('apply')
    expect(loadConfig({ dataDir: data, cwd, env: { LIGHTCODE_DISABLE: '1' } }).config.economy.mode).toBe('off')
  })
  it('turns Economy off on any invalid setting and keeps project files away from retention', () => {
    const data = temp(), cwd = temp()
    mkdirSync(join(cwd, '.lightcode'))
    writeFileSync(join(cwd, '.lightcode', 'config.json'), JSON.stringify({ artifacts: { retentionDays: 1 } }))
    const loaded = loadConfig({ dataDir: data, cwd, env: {} })
    expect(loaded.config.economy.mode).toBe('off')
    expect(loaded.config.artifacts.retentionDays).toBe(14)
    expect(loaded.problems[0]).toContain('unsupported setting artifacts')
    writeFileSync(join(data, 'config.json'), '{broken')
    expect(loadConfig({ dataDir: data, env: {} }).config.economy.mode).toBe('off')
  })
})

describe('collectDaily', () => {
  it('prunes at most once per day', () => {
    const data = temp()
    let calls = 0
    const prune = () => { calls++; return 0 }
    expect(collectDaily(data, prune, 14, 1_000_000_000_000)).toBe(0)
    expect(collectDaily(data, prune, 14, 1_000_000_000_000 + 1000)).toBeUndefined()
    expect(calls).toBe(1)
  })
})
