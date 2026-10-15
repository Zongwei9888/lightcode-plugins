import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { sha256 } from '@lightcode/core'
import type { EconomyRecord, JournalRecord, ShadowRecallRecord } from '@lightcode/protocol'
import { FileArtifactStore, FileJournal, RuleStore, removeTree } from '@lightcode/store'
import {
  acquireRunLock, cancelEvolution, checkpointRecord, disabledRules, evolveContext, outcomeSentence, readEvolveStatus, readRunStatus, releaseRunLock, reviewActiveRules,
  pruneRuns, refreshScan, ruleChanges, ruleUse, runEvolution, scanEvidence, startEvolution, takeAnnouncement, takeReadyNotice, writeRunStatus,
} from '../src/index.ts'

const runner = fileURLToPath(new URL('./fixtures/runner.ts', import.meta.url))
const dirs: string[] = []
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'lightcode-learning-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) removeTree(dir) })

const ruleFiles = (ids: string[]) => [
  { path: 'index.json', text: JSON.stringify({ schemaVersion: 1, rules: ids.map(id => ({ id, file: `rules/${id}.js` })) }) },
  ...ids.map(id => ({ path: `rules/${id}.js`, text: `defineRule({ project(input, lc) { return null } })` })),
]

const decision = (fields: Partial<EconomyRecord>): EconomyRecord => ({
  schemaVersion: 1, type: 'economy/decision', time: '2026-10-14T10:00:00.000Z', host: 'pi', sessionId: 's', callId: 'c', tool: 'bash', command: './build.sh',
  exitCode: 0, delivery: 'in-process', streams: 'merged', mode: 'apply', outcome: 'projected', filter: 'learned-rule', runtimeVersion: 'v', policyHash: 'p',
  raw: { sha256: 'a'.repeat(64), bytes: 400, tokens: 100, stored: true }, projected: { sha256: 'b'.repeat(64), bytes: 40, tokens: 10 }, ...fields,
})

/** Evidence as the engine keeps it: the original in the store, its decision in the journal. */
function observe(home: string, command: string, output: string, time = new Date().toISOString()) {
  new FileArtifactStore(home).save(output)
  const { filter: _filter, projected: _projected, ...base } = decision({})
  new FileJournal(home).append({ ...base, time, command, callId: `c-${sha256(output).slice(0, 6)}`, outcome: 'passed', reason: 'no-filter-match',
    raw: { sha256: sha256(output), bytes: output.length, tokens: Math.ceil(output.length / 4), stored: true },
    layout: { stdout: { start: 0, length: output.length } } })
}

const progress = (seed: number) => Array.from({ length: 120 }, (_, i) => `[${String(i + 1).padStart(3)}/120] Compiling crate_${seed}_${i} v0.${seed}.${i}`).join('\n') + '\nFinished release\n'

/** A learner that writes a general progress rule and runs the checker, as an agent would. */
function learnerScript(dir: string): string {
  const script = join(dir, 'learner.sh')
  writeFileSync(script, `#!/bin/sh
set -e
mkdir -p rules-work/rules
cat > rules-work/index.json <<'JSON'
{ "schemaVersion": 1, "rules": [{ "id": "compile-progress", "file": "rules/compile-progress.js", "transformation": "noise-removal" }] }
JSON
cat > rules-work/rules/compile-progress.js <<'JS'
defineRule({ project(input, lc) {
  if (!input.argv || input.argv[0] !== './build.sh') return null
  return lc.keepLines(input.raw, line => !/^\\[\\s*\\d+\\/\\d+\\] Compiling /.test(line.text), n => '[' + n + ' compile progress lines omitted]\\n')
} })
JS
./check > check.txt || true
`)
  return `sh ${script}`
}

async function until<T>(read: () => T | undefined, timeoutMs = 30_000): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() - started > timeoutMs) throw new Error('timed out')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

describe('learned rules in use', () => {
  it('counts what each rule shortened and how often the agent asked for the original', () => {
    const records: JournalRecord[] = [
      ...[1, 2, 3, 4, 5].map(i => decision({ callId: `c${i}`, rule: 'noisy' })),
      decision({ callId: 'k1', rule: 'quiet' }),
      decision({ callId: 'old', rule: 'noisy', time: '2026-10-01T00:00:00.000Z' }),
      checkpointRecord({ host: 'pi', sessionId: 's', time: '2026-10-14T11:00:00.000Z' }, { kind: 'lightshadow', checkpointTokens: 1,
        plan: { contract: [], segmentTokens: 1, references: [1, 2, 3].map(i => ({ id: `o-00000000000${i}`, sha256: 'a'.repeat(64), bytes: 1, tokens: 1, tool: 'bash', callId: `c${i}`, excerpt: '' })) } }),
      ...[1, 2, 3].map((i): ShadowRecallRecord => ({ schemaVersion: 1, type: 'shadow/recall', time: '2026-10-14T12:00:00.000Z', host: 'pi', sessionId: 's',
        callId: `r${i}`, id: `o-00000000000${i}`, original: true, outcome: 'returned', bytes: 1 })),
      // Paging through the same original again counts once; not the original, or an unknown reference, not at all.
      { schemaVersion: 1, type: 'shadow/recall', time: '2026-10-14T12:01:00.000Z', host: 'pi', sessionId: 's', callId: 'r4', id: 'o-000000000001', original: true, outcome: 'window', bytes: 1 },
      { schemaVersion: 1, type: 'shadow/recall', time: '2026-10-14T12:00:00.000Z', host: 'pi', sessionId: 's', callId: 'r9', id: 'o-000000000001', original: false, outcome: 'returned', bytes: 1 },
      { schemaVersion: 1, type: 'shadow/recall', time: '2026-10-14T12:00:00.000Z', host: 'pi', sessionId: 's', callId: 'r8', id: 'o-ffffffffffff', original: true, outcome: 'returned', bytes: 1 },
    ]
    const uses = ruleUse(records, { since: '2026-10-10T00:00:00.000Z' })
    expect(uses.get('noisy')).toEqual({ id: 'noisy', projections: 5, savedTokens: 450, originalRecalls: 3 })
    expect(uses.get('quiet')).toEqual({ id: 'quiet', projections: 1, savedTokens: 90, originalRecalls: 0 })
  })

  it('switches off a rule the agent keeps needing the original for, as an adoption that can be rolled back', () => {
    const home = temp()
    const store = new RuleStore(home)
    const first = store.installFiles(ruleFiles(['noisy', 'quiet']))
    store.activate(first)
    const uses = new Map([['noisy', { id: 'noisy', projections: 10, savedTokens: 900, originalRecalls: 3 }], ['quiet', { id: 'quiet', projections: 40, savedTokens: 900, originalRecalls: 2 }]])
    expect(reviewActiveRules(home, uses)).toEqual([{ id: 'noisy', reason: 'the agent asked for the original 3 of 10 times it shortened output', recalls: 3, uses: 10 }])
    const active = store.state().active!
    expect(active).not.toBe(first)
    expect(store.files(active).map(file => file.path).sort()).toEqual(['index.json', 'rules/quiet.js'])
    expect(disabledRules(home)).toEqual([{ id: 'noisy', reason: 'the agent asked for the original 3 of 10 times it shortened output', recalls: 3, uses: 10, time: expect.any(String) }])
    // Nothing more to switch off; and rollback brings it back.
    expect(reviewActiveRules(home, uses)).toEqual([])
    expect(store.rollback()).toBe(first)
  })
})

describe('describing a run', () => {
  it('names what a proposal added, changed and removed, and says so in its outcome', () => {
    const parent = ruleFiles(['kept', 'edited', 'dropped'])
    const candidate = [...ruleFiles(['kept', 'edited', 'new']).filter(file => file.path !== 'rules/edited.js'),
      { path: 'rules/edited.js', text: 'defineRule({ project() { return null } }) // better' }]
    expect(ruleChanges(parent, candidate)).toEqual({ added: ['new'], changed: ['edited'], removed: ['dropped'] })
    expect(ruleChanges([], ruleFiles(['a']))).toEqual({ added: ['a'], changed: [], removed: [] })
    expect(outcomeSentence({ result: 'adopted', rules: ['kept', 'new'], changes: { added: ['new'], changed: [], removed: [] }, gainTokens: 1200, cases: 9,
      generalization: { status: 'confirmed', commands: ['x'], heldOutCases: 2, heldOutGain: 10 } }))
      .toBe('adopted rule new: +1.2k tokens on 9 recorded outputs, confirmed on 2 it had not seen')
    expect(outcomeSentence({ result: 'rejected', reasons: ['did-not-generalize'] })).toBe('nothing adopted: they only fit the examples the learner saw')
  })
})

describe('run status', () => {
  it('holds one run at a time, and takes over a lock whose process is gone', () => {
    const home = temp()
    expect(acquireRunLock(home, 'r1')).toBe(true)
    expect(acquireRunLock(home, 'r2')).toBe(false)
    releaseRunLock(home)
    writeFileSync(join(home, 'evolve', 'run.lock'), JSON.stringify({ pid: 2 ** 22 + 12345, runId: 'gone' }))
    expect(acquireRunLock(home, 'r3')).toBe(true)
    releaseRunLock(home)
  })

  it('reads a run whose process died as interrupted, and announces a finished run once per host', () => {
    const home = temp()
    writeRunStatus(home, { schemaVersion: 1, runId: 'r-1', host: 'pi', learner: 'pi', pid: 2 ** 22 + 12345, startedAt: '2026-10-14T00:00:00.000Z', phase: 'learning' })
    expect(readRunStatus(home)).toMatchObject({ running: false, phase: 'done', outcome: { result: 'interrupted' } })
    writeRunStatus(home, { schemaVersion: 1, runId: 'r-2', host: 'pi', learner: 'pi', pid: process.pid, startedAt: '2026-10-14T00:00:00.000Z', phase: 'done',
      outcome: { result: 'adopted', gainTokens: 100, rules: ['x'] } })
    expect(takeAnnouncement(home, 'pi')).toMatchObject({ runId: 'r-2', outcome: { result: 'adopted' } })
    expect(takeAnnouncement(home, 'pi')).toBeUndefined()
    expect(takeAnnouncement(home, 'dsh')).toMatchObject({ runId: 'r-2' })
  })

  it('mentions commands worth learning from once, again when their tokens double, and afresh after a run', () => {
    const home = temp()
    const scan = (opportunities: { command: string; cases: number; leftTokens: number }[], time = new Date().toISOString()) => {
      mkdirSync(join(home, 'evolve'), { recursive: true })
      writeFileSync(join(home, 'evolve', 'scan.json'), JSON.stringify({ schemaVersion: 1, time, evidence: 9, newEvidence: 9, leftTokens: 0, opportunities,
        ready: opportunities.some(item => item.cases >= 3 && item.leftTokens >= 2000), rules: [], disabled: [] }))
    }
    scan([{ command: 'cargo test', cases: 2, leftTokens: 9000 }])
    expect(takeReadyNotice(home, 'dsh')).toBeUndefined()
    scan([{ command: 'cargo test', cases: 4, leftTokens: 3000 }, { command: 'ls', cases: 5, leftTokens: 500 }])
    expect(takeReadyNotice(home, 'dsh')).toEqual([{ command: 'cargo test', cases: 4, leftTokens: 3000 }])
    expect(takeReadyNotice(home, 'dsh')).toBeUndefined()
    expect(takeReadyNotice(home, 'pi')).toHaveLength(1)
    scan([{ command: 'cargo test', cases: 6, leftTokens: 5000 }])
    expect(takeReadyNotice(home, 'dsh')).toBeUndefined()
    scan([{ command: 'cargo test', cases: 9, leftTokens: 6100 }, { command: 'pytest', cases: 3, leftTokens: 2500 }])
    expect(takeReadyNotice(home, 'dsh')?.map(item => item.command)).toEqual(['cargo test', 'pytest'])
    // A command newly worth learning from comes first: the toast names only the first few.
    scan([{ command: 'cargo test', cases: 9, leftTokens: 6100 }, { command: 'pytest', cases: 3, leftTokens: 2500 }, { command: './link.sh', cases: 3, leftTokens: 2200 }])
    expect(takeReadyNotice(home, 'dsh')?.map(item => item.command)).toEqual(['./link.sh', 'cargo test', 'pytest'])
    // A run finished after this scan: its evidence is what that run learned from.
    writeRunStatus(home, { schemaVersion: 1, runId: 'r-9', host: 'dsh', learner: 'dsh', pid: process.pid, startedAt: '2026-10-14T00:00:00.000Z',
      finishedAt: new Date(Date.now() + 1000).toISOString(), phase: 'done', outcome: { result: 'rejected' } })
    expect(takeReadyNotice(home, 'dsh')).toBeUndefined()
    scan([{ command: 'cargo test', cases: 3, leftTokens: 2100 }], new Date(Date.now() + 2000).toISOString())
    expect(takeReadyNotice(home, 'dsh')).toEqual([{ command: 'cargo test', cases: 3, leftTokens: 2100 }])
  })
})

describe('background learning', () => {
  const background = (home: string) => ({ runner, node: process.execPath, nodeArgs: ['--conditions=source'], env: { ...process.env, LIGHTCODE_HOME: home } })

  it('suggests a run once a command has enough output left to learn from', () => {
    const home = temp()
    observe(home, './build.sh', progress(1))
    const env = { ...process.env, LIGHTCODE_HOME: home }
    expect(scanEvidence(evolveContext(env))).toMatchObject({ evidence: 1, ready: false })
    observe(home, './build.sh', progress(2))
    observe(home, './build.sh', progress(3))
    const scan = scanEvidence(evolveContext(env))
    expect(scan).toMatchObject({ evidence: 3, newEvidence: 3, ready: true, opportunities: [{ command: './build.sh', cases: 3 }] })
    expect(scan.opportunities[0]!.leftTokens).toBeGreaterThan(2000)
    expect(readEvolveStatus(home).scan).toEqual(scan)
  })

  it('runs the learner in its own process, verifies with held-out observations, adopts, and announces', async () => {
    const home = temp(), work = temp()
    for (const seed of [1, 2, 3]) observe(home, './build.sh', progress(seed))
    // A file the run must delete when it ends (as DSH's overlay), and one outside LightCode's directory it must leave alone.
    mkdirSync(join(home, 'evolve'), { recursive: true })
    const overlay = join(home, 'evolve', 'overlay.yml'), outside = join(work, 'outside.yml')
    writeFileSync(overlay, 'x'); writeFileSync(outside, 'x')
    const started = startEvolution(home, { ...background(home), host: 'pi', learner: { argv: [learnerScript(work)], shell: true, label: 'test learner' }, cleanup: [overlay, outside] })
    expect(started).toMatchObject({ runId: expect.any(String) })
    expect(readRunStatus(home)).toMatchObject({ host: 'pi', learner: 'test learner', running: true })
    // A second start while the first runs is refused.
    expect(startEvolution(home, { ...background(home), host: 'dsh', learner: { argv: ['true'], shell: true, label: 'x' } })).toEqual({ error: 'running' })
    const run = await until(() => { const status = readRunStatus(home); return status?.phase === 'done' ? status : undefined })
    expect(run).toMatchObject({ runId: (started as { runId: string }).runId, evidence: 3, shown: 2, checks: 1, lastCheck: { accepted: true },
      outcome: { result: 'adopted', rules: ['compile-progress'], generalization: { status: 'confirmed', heldOutCases: 1 } } })
    expect(readEvolveStatus(home).rules).toMatchObject({ rules: [{ id: 'compile-progress', transformation: 'noise-removal' }], gainTokens: expect.any(Number) })
    expect(takeAnnouncement(home, 'pi')).toMatchObject({ outcome: { result: 'adopted' } })
    await until(() => existsSync(overlay) ? undefined : true)
    expect(existsSync(outside)).toBe(true)
    // The run scanned again: the build output is short now, nothing left to suggest.
    expect(readEvolveStatus(home).scan).toMatchObject({ ready: false })
  }, 60_000)

  it('stops a run on cancel, with the learner and everything it started', async () => {
    const home = temp()
    for (const seed of [1, 2, 3]) observe(home, './build.sh', progress(seed))
    startEvolution(home, { ...background(home), host: 'pi', learner: { argv: ['sleep 60 & sleep 60'], shell: true, label: 'slow' } })
    await until(() => readRunStatus(home)?.phase === 'learning' ? true : undefined)
    const at = Date.now()
    expect(cancelEvolution(home)).toBe(true)
    const run = await until(() => { const status = readRunStatus(home); return status?.phase === 'done' ? status : undefined })
    expect(run.outcome).toEqual({ result: 'cancelled' })
    expect(Date.now() - at).toBeLessThan(10_000)
    expect(new RuleStore(home).state().active).toBeNull()
    expect(readFileSync(join(home, 'evolve', run.runId, 'learner.log'), 'utf8')).toContain('cancelled')
  }, 60_000)
})

describe('review fixes', () => {
  const stamp = (offset: number) => new Date(Date.now() + offset).toISOString()

  it('a rollback starts the monitor afresh instead of switching the rule off again', () => {
    const home = temp()
    const store = new RuleStore(home)
    const first = store.installFiles(ruleFiles(['noisy']))
    store.activate(first, {}, new Date(Date.now() - 60_000))
    const journal = new FileJournal(home)
    for (const i of [1, 2, 3]) journal.append(decision({ callId: `c${i}`, rule: 'noisy', time: stamp(-30_000) }))
    journal.append(checkpointRecord({ host: 'pi', sessionId: 's', time: stamp(-29_000) }, { kind: 'lightshadow', checkpointTokens: 1,
      plan: { contract: [], segmentTokens: 1, references: [1, 2, 3].map(i => ({ id: `o-00000000000${i}`, sha256: 'a'.repeat(64), bytes: 1, tokens: 1, tool: 'bash', callId: `c${i}`, excerpt: '' })) } }))
    for (const i of [1, 2, 3]) journal.append({ schemaVersion: 1, type: 'shadow/recall', time: stamp(-28_000), host: 'pi', sessionId: 's', callId: `r${i}`, id: `o-00000000000${i}`, original: true, outcome: 'returned', bytes: 1 })
    const env = { ...process.env, LIGHTCODE_HOME: home }
    expect(scanEvidence(evolveContext(env)).disabled.map(item => item.id)).toEqual(['noisy'])
    expect(store.rollback()).toBe(first)
    expect(scanEvidence(evolveContext(env)).disabled).toEqual([])
    expect(store.state().active).toBe(first)
  })

  it('reads a run past its deadline as interrupted, and signals only a process that holds its lock', () => {
    const home = temp()
    writeRunStatus(home, { schemaVersion: 1, runId: 'r-1', host: 'pi', learner: 'pi', pid: process.pid, startedAt: stamp(-3_600_000),
      deadline: stamp(-1_800_000), phase: 'learning' })
    expect(readRunStatus(home)).toMatchObject({ running: false, outcome: { result: 'interrupted' } })
    // Alive and within its deadline, but someone else holds the lock: no signal.
    writeRunStatus(home, { schemaVersion: 1, runId: 'r-2', host: 'pi', learner: 'pi', pid: process.pid, startedAt: stamp(-60_000), deadline: stamp(600_000), phase: 'learning' })
    expect(acquireRunLock(home, 'someone-else')).toBe(true)
    expect(cancelEvolution(home)).toBe(false)
    releaseRunLock(home)
  })

  it('does not take over a lock it cannot read for a moment, and does take over an old unreadable one', () => {
    const home = temp()
    expect(acquireRunLock(home, 'r1')).toBe(true)
    releaseRunLock(home)
    writeFileSync(join(home, 'evolve', 'run.lock'), '')
    expect(acquireRunLock(home, 'r2')).toBe(false)
    const old = new Date(Date.now() - 60_000)
    utimesSync(join(home, 'evolve', 'run.lock'), old, old)
    expect(acquireRunLock(home, 'r3')).toBe(true)
    releaseRunLock(home)
  })

  it('holds back only output worth learning from, so a general rule on one sample is not called overfit', async () => {
    const home = temp(), work = temp()
    observe(home, './build.sh', progress(1))
    for (const n of [1, 2, 3]) observe(home, './build.sh', `Finished run ${n}\n`)
    const result = await runEvolution(evolveContext({ ...process.env, LIGHTCODE_HOME: home }), {
      learner: { argv: [learnerScript(work)], shell: true, label: 't' }, checker: [process.execPath, '--conditions=source', runner], host: 'cli', env: { ...process.env, LIGHTCODE_HOME: home } })
    expect(result?.outcome).toMatchObject({ result: 'adopted', generalization: { status: 'untested' } })
  }, 60_000)

  it('reports a learner that crashed as failed, not as having found nothing to change', async () => {
    const home = temp()
    for (const seed of [1, 2, 3]) observe(home, './build.sh', progress(seed))
    const result = await runEvolution(evolveContext({ ...process.env, LIGHTCODE_HOME: home }), {
      learner: { argv: ['exit 3'], shell: true, label: 't' }, checker: [process.execPath, runner], host: 'cli', env: { ...process.env, LIGHTCODE_HOME: home } })
    expect(result?.outcome).toMatchObject({ result: 'failed', error: expect.stringMatching(/^the learner exited with 3; see .*learner\.log$/) })
    const missing = await runEvolution(evolveContext({ ...process.env, LIGHTCODE_HOME: home }), {
      learner: { argv: ['/nonexistent/learner'], label: 't' }, checker: [process.execPath, runner], host: 'cli', env: { ...process.env, LIGHTCODE_HOME: home } })
    expect(missing?.outcome).toMatchObject({ result: 'failed', error: expect.stringMatching(/^the learner did not run/) })
  }, 60_000)

  it('does not adopt over rules that changed while the learner ran', async () => {
    const home = temp(), work = temp()
    for (const seed of [1, 2, 3]) observe(home, './build.sh', progress(seed))
    const other = new RuleStore(home).installFiles(ruleFiles(['other']))
    const script = join(work, 'sneaky.sh')
    writeFileSync(script, `${readFileSync(learnerScript(work).slice(3), 'utf8')}
node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({ schemaVersion: 1, active: '${other}', history: [] }))" ${JSON.stringify(join(home, 'rules', 'active.json'))}
`)
    const result = await runEvolution(evolveContext({ ...process.env, LIGHTCODE_HOME: home }), {
      learner: { argv: [`sh ${script}`], shell: true, label: 't' }, checker: [process.execPath, '--conditions=source', runner], host: 'cli', env: { ...process.env, LIGHTCODE_HOME: home } })
    expect(result?.outcome).toMatchObject({ result: 'failed', error: 'the active learned rules changed while the learner ran; nothing adopted' })
  }, 60_000)

  it('keeps the held-out figures out of what the learner reads from ./check', async () => {
    const home = temp(), work = temp()
    for (const seed of [1, 2, 3]) observe(home, './build.sh', progress(seed))
    const result = await runEvolution(evolveContext({ ...process.env, LIGHTCODE_HOME: home }), {
      learner: { argv: [learnerScript(work)], shell: true, label: 't' }, checker: [process.execPath, '--conditions=source', runner], host: 'cli', env: { ...process.env, LIGHTCODE_HOME: home } })
    const seen = readFileSync(join(result!.workspace, 'check.txt'), 'utf8')
    expect(seen).toMatch(/^ACCEPTED/)
    expect(seen).not.toMatch(/held-out|unseen/)
    expect(result?.outcome.generalization?.status).toBe('confirmed')
  }, 60_000)

  it('removes old run directories, which copy recorded output', () => {
    const home = temp()
    const names = Array.from({ length: 12 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}T10-00-00-000Z-abcd`)
    for (const name of names) mkdirSync(join(home, 'evolve', name, 'workspace'), { recursive: true })
    const removed = pruneRuns(home, names.at(-1)!, 14, Date.parse('2026-10-14T12:00:00.000Z'))
    expect(removed).toEqual(names.slice(0, 2))
    expect(pruneRuns(home, 'x', 3, Date.parse('2026-10-14T12:00:00.000Z'))).toEqual(names.slice(2, 11))
  })

  it('refreshes the scan whenever asked after a good one, but backs off after one that failed', () => {
    const home = temp()
    const options = { runner: '/nonexistent/runner.js', node: process.execPath, env: { ...process.env, LIGHTCODE_HOME: home } }
    expect(refreshScan(home, { ...options, maxAgeMs: 0 })).toBe(true)
    // That attempt produced no scan (the runner does not exist): no new attempt for a minute.
    expect(refreshScan(home, { ...options, maxAgeMs: 0 })).toBe(false)
    // A scan newer than the attempt: asking again goes ahead.
    scanEvidence(evolveContext(options.env))
    rmSync(join(home, 'evolve', 'scan.lock'), { force: true })
    expect(refreshScan(home, { ...options, maxAgeMs: 0 })).toBe(true)
  })
})
