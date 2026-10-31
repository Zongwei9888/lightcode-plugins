import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const main = fileURLToPath(new URL('../src/main.ts', import.meta.url))
const dirs: string[] = []
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'tokenwise-learn-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function tokenwise(args: string[], home: string, input?: string, env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(process.execPath, ['--conditions=source', main, ...args], { input, encoding: 'utf8',
    env: { ...process.env, TOKENWISE_HOME: home, TOKENWISE_DISABLE: '', ...env } })
  return { status: result.status, out: result.stdout, err: result.stderr }
}

const startup = (home: string, host = 'claude', env: NodeJS.ProcessEnv = {}) =>
  tokenwise(['hook', host], home, JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 's' }), env).out

function writeJson(path: string, value: unknown) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(value))
}

describe('tokenwise learn', () => {
  it('needs a learner it knows', () => {
    const home = temp()
    expect(tokenwise(['learn'], home)).toMatchObject({ status: 2, err: expect.stringContaining('--learner pi|dsh|claude|codex|codebuddy|grok') })
    expect(tokenwise(['learn', '--learner', 'vim'], home).status).toBe(2)
    expect(tokenwise(['learn', 'later'], home).status).toBe(2)
  })

  it('runs in the background, and status follows it to the end', async () => {
    const home = temp()
    const started = tokenwise(['learn', '--learner', 'claude'], home)
    expect(started).toMatchObject({ status: 0, out: expect.stringContaining('Learning with claude in the background') })
    // With no recorded output there is nothing to learn from; the run ends before any learner starts.
    let status = ''
    for (let i = 0; i < 100 && !status.includes('Last run'); i++) {
      await new Promise(resolve => setTimeout(resolve, 200))
      status = tokenwise(['learn', 'status'], home).out
    }
    expect(status).toContain('Last run (claude, ')
    expect(status).toContain('nothing to learn from yet')
    expect(status).toContain('No learned rules in use.')
    expect(tokenwise(['learn', 'cancel'], home).out).toBe('No learning run in progress.\n')
  }, 30_000)
})

describe('the startup notice', () => {
  it('says once when recorded output is worth learning from, naming the host\'s own command', () => {
    const home = temp()
    const opportunities = [{ command: './deploy.sh', cases: 5, leftTokens: 9000 }, { command: 'make', cases: 4, leftTokens: 3000 }]
    writeJson(join(home, 'evolve', 'scan.json'), { schemaVersion: 1, time: new Date().toISOString(), evidence: 9, newEvidence: 9, leftTokens: 12000,
      opportunities, ready: true, rules: [], disabled: [] })
    expect(JSON.parse(startup(home))).toEqual({ systemMessage:
      'TokenWise: recorded output from ./deploy.sh, make is worth learning from. Run /tokenwise:learn to learn filters for it.' })
    expect(startup(home)).toBe('')
    expect(JSON.parse(startup(home, 'codex')).systemMessage).toContain('Run $tokenwise learn to learn')
    // A learner's own session says nothing.
    expect(startup(home, 'grok', { TOKENWISE_DISABLE: '1' })).toBe('')
    // Grok calls a new session's start `new` (seen from Grok 1.0.70), and a resumed one is not a start.
    const grok = (source: string) => tokenwise(['hook', 'grok'], home, JSON.stringify({ hookEventName: 'session_start', hook_event_name: 'SessionStart', source, session_id: 'g' })).out
    expect(grok('resume')).toBe('')
    expect(JSON.parse(grok('new')).systemMessage).toContain('Run /tokenwise:learn')
  })

  it('says once how a learning run ended', () => {
    const home = temp()
    writeJson(join(home, 'evolve', 'status.json'), { schemaVersion: 1, runId: 'r1', host: 'cli', learner: 'claude', pid: 999999, startedAt: '2026-10-30T10:00:00.000Z',
      phase: 'done', finishedAt: '2026-10-30T10:05:00.000Z', outcome: { result: 'rejected', reasons: ['did-not-generalize'] } })
    expect(JSON.parse(startup(home, 'codebuddy')).systemMessage).toBe('TokenWise learning: nothing adopted: they only fit the examples the learner saw.')
    expect(startup(home, 'codebuddy')).toBe('')
    // Not after a compaction: that SessionStart belongs to the catalog.
    expect(tokenwise(['hook', 'claude'], home, JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact', session_id: 's', transcript_path: '/nope' })).out).toBe('')
  })
})
