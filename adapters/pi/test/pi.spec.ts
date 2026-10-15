import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileArtifactStore, FileJournal, readJournals } from '@lightcode-ai/store'
import { collectSubagents, summarizeEconomy } from '@lightcode-ai/mechanisms'
import type { EconomyRecord, JournalRecord } from '@lightcode-ai/protocol'
import { createLightCodeExtension, PARENT_SESSION_ENV } from '../src/extension.ts'
import { runPi, textOf } from './harness.ts'

const dirs: string[] = []
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'lightcode-pi-test-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function workspace() {
  const cwd = temp()
  mkdirSync(join(cwd, 'src'))
  for (let f = 0; f < 3; f++) {
    writeFileSync(join(cwd, 'src', `f${f}.ts`), Array.from({ length: 90 }, (_, i) => `export const value${i} = ${i} // value line`).join('\n') + '\n')
  }
  writeFileSync(join(cwd, 'failing.test.mjs'), "import test from 'node:test'\nimport assert from 'node:assert'\n"
    + Array.from({ length: 40 }, (_, i) => `test('passes ${i}', () => {})\n`).join('')
    + "test('fails', () => { assert.strictEqual(1, 2, 'necessary failure evidence') })\n")
  return cwd
}

const sessionEntries = (file: string) => readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, any>)

describe('pi adapter (real pi 1.1 session, faux model)', { timeout: 30_000 }, () => {
  it('shows the model a projection while the session file keeps the original', async () => {
    const cwd = workspace(), dataDir = temp()
    const raw = spawnSync('/bin/sh', ['-c', 'grep -rn value src'], { cwd, encoding: 'utf8' }).stdout
    const run = await runPi({ cwd, extension: createLightCodeExtension({ dataDir, env: {} }), commands: ['grep -rn value src'] })
    const delivered = textOf(run.seen[0]![0])
    expect(delivered.length).toBeLessThan(raw.length)
    expect(delivered).toContain('omitted')
    const entries = sessionEntries(run.sessionFile)
    const toolResult = entries.find(entry => entry.type === 'message' && entry.message.role === 'toolResult')!
    expect(textOf(toolResult.message.content)).toBe(raw)
    const edit = entries.find(entry => entry.type === 'context_edit')!
    expect(edit.targetId).toBe(toolResult.id)
    const records = new FileJournal(dataDir).read({ host: 'pi', sessionId: run.sessionId }) as EconomyRecord[]
    const projected = records.find(record => record.outcome === 'projected')!
    expect(projected).toMatchObject({ filter: 'grep', delivery: 'in-process', streams: 'merged', tool: 'bash' })
    expect(new FileArtifactStore(dataDir).read(projected.raw!.sha256)).toBe(raw)
  })

  it('keeps the failure evidence and pi\'s exit-code footer of a failing test run', async () => {
    const cwd = workspace(), dataDir = temp()
    const command = 'node --test --test-reporter=tap failing.test.mjs'
    const run = await runPi({ cwd, extension: createLightCodeExtension({ dataDir, env: {} }), commands: [command] })
    const delivered = textOf(run.seen[0]![0])
    expect(delivered).toContain('necessary failure evidence')
    expect(delivered).toMatch(/\n\nCommand exited with code 1$/)
    const raw = textOf(sessionEntries(run.sessionFile).find(entry => entry.type === 'message' && entry.message.role === 'toolResult')!.message.content)
    expect(delivered.length).toBeLessThan(raw.length)
  })

  it('normalizes a search command, keeping the original in the assistant message', async () => {
    const cwd = workspace(), dataDir = temp()
    const run = await runPi({ cwd, extension: createLightCodeExtension({ dataDir, env: {} }), commands: ['grep -i value src/f0.ts'] })
    const entries = sessionEntries(run.sessionFile)
    const call = entries.find(entry => entry.type === 'message' && entry.message.role === 'assistant')!.message.content
      .find((block: { type: string }) => block.type === 'toolCall')
    expect(call.arguments.command).toBe('grep -i value src/f0.ts')
    const records = new FileJournal(dataDir).read({ host: 'pi', sessionId: run.sessionId }) as JournalRecord[]
    expect(records.find(record => record.type === 'economy/command-rewrite')).toMatchObject({ rule: 'search-record-format', rewritten: 'grep -n -H -i value src/f0.ts' })
    expect(records.find(record => record.type === 'economy/decision')).toMatchObject({ outcome: 'projected', filter: 'grep', command: 'grep -n -H -i value src/f0.ts' })
  })

  it('leaves unrecognized output, and everything when disabled, untouched', async () => {
    const cwd = workspace(), dataDir = temp()
    const raw = spawnSync('/bin/sh', ['-c', 'grep -rn value src'], { cwd, encoding: 'utf8' }).stdout
    const other = await runPi({ cwd, extension: createLightCodeExtension({ dataDir, env: {} }), commands: ['seq 1 400'] })
    expect(textOf(other.seen[0]![0])).toBe(spawnSync('seq', ['1', '400'], { encoding: 'utf8' }).stdout)
    const off = await runPi({ cwd, extension: createLightCodeExtension({ dataDir, env: { LIGHTCODE_DISABLE: '1' } }), commands: ['grep -rn value src'] })
    expect(textOf(off.seen[0]![0])).toBe(raw)
    expect(sessionEntries(off.sessionFile).some(entry => entry.type === 'context_edit')).toBe(false)
  })

  it('lays out pi\'s own grep and find results losslessly, keeping the originals in the session', async () => {
    const cwd = workspace(), dataDir = temp()
    mkdirSync(join(cwd, 'src', 'deep', 'nested', 'modules'), { recursive: true })
    for (let f = 0; f < 12; f++) writeFileSync(join(cwd, 'src', 'deep', 'nested', 'modules', `module${f}.ts`), 'export {}\n')
    const run = await runPi({ cwd, extension: createLightCodeExtension({ dataDir, env: {} }),
      commands: [{ tool: 'grep', args: { pattern: 'value', path: 'src' } }, { tool: 'find', args: { pattern: '*.ts', path: 'src/deep' } }] })
    const grep = textOf(run.seen[0]![0]), find = textOf(run.seen[1]![1])
    const entries = sessionEntries(run.sessionFile)
    const originals = entries.filter(entry => entry.type === 'message' && entry.message.role === 'toolResult').map(entry => textOf(entry.message.content))
    expect(originals[0]).toMatch(/^f\d\.ts:1: export const value0/)
    expect(grep).toMatch(/^\[matches in f\d\.ts; every match retained\]\n {2}1: export const value0 = 0 \/\/ value line\n/)
    // Every row is still there: putting the file back in front of each restores pi's own text.
    expect(grep.replace(/\[matches in (.+?); every match retained\]\n((?: {2}.*(?:\n|$))+)/g,
      (_: string, file: string, block: string) => block.replace(/^ {2}/gm, `${file}:`))).toBe(originals[0])
    expect(find).toContain('[paths grouped by directory; original order retained]\nnested/modules/\n  module')
    expect(find.split('\n').filter(line => /module\d+\.ts/.test(line))).toHaveLength(12)
    const records = new FileJournal(dataDir).read({ host: 'pi', sessionId: run.sessionId }) as EconomyRecord[]
    expect(records.map(record => [record.tool, record.outcome, record.filter])).toEqual([['grep', 'projected', 'native-grep'], ['find', 'projected', 'native-glob']])
    expect(new FileArtifactStore(dataDir).read(records[0]!.raw!.sha256)).toBe(originals[0])
  })

  it('links a subagent pi process to the session that started it', async () => {
    const cwd = workspace(), dataDir = temp()
    // The parent's environment is what the pi processes it starts inherit.
    const parentEnv: NodeJS.ProcessEnv = {}
    const parent = await runPi({ cwd, extension: createLightCodeExtension({ dataDir, env: parentEnv, pid: 1001, ppid: 1 }), commands: ['seq 1 3'] })
    expect(parentEnv[PARENT_SESSION_ENV]).toBe(`pi:1001:${parent.sessionId}`)
    const childEnv = { ...parentEnv }
    const child = await runPi({ cwd, extension: createLightCodeExtension({ dataDir, env: childEnv, pid: 1002, ppid: 1001 }), commands: ['grep -rn value src'] })
    expect(childEnv[PARENT_SESSION_ENV]).toBe(`pi:1002:${child.sessionId}`)
    const read = (sessionId: string) => readJournals([dataDir], { host: 'pi', sessionId })
    expect(read(parent.sessionId).filter(record => record.type === 'session/subagent')).toMatchObject([{ childSessionId: child.sessionId }])
    const subagents = collectSubagents(read, parent.sessionId)
    expect(subagents.sessions).toEqual([child.sessionId])
    expect(summarizeEconomy(subagents.records)).toMatchObject({ projected: 1 })
    // A session that LightCode does not run in hands nothing down.
    const offEnv: NodeJS.ProcessEnv = { LIGHTCODE_DISABLE: '1' }
    await runPi({ cwd, extension: createLightCodeExtension({ dataDir, env: offEnv, pid: 1003, ppid: 1 }), commands: ['seq 1 3'] })
    expect(offEnv[PARENT_SESSION_ENV]).toBeUndefined()
  })

  it('does not take a later session of the same process, or a pi started further down, for a subagent', async () => {
    const cwd = workspace(), dataDir = temp()
    const env: NodeJS.ProcessEnv = {}
    // /new, /resume, /fork and /reload run the extension again in the same process, with the same environment.
    const first = await runPi({ cwd, extension: createLightCodeExtension({ dataDir, env, pid: 2001, ppid: 1 }), commands: ['grep -rn value src'] })
    const second = await runPi({ cwd, extension: createLightCodeExtension({ dataDir, env, pid: 2001, ppid: 1 }), commands: ['grep -rn value src'] })
    // A pi started from a long-lived process (a shell, a tmux server) that itself came from this pi.
    const later = await runPi({ cwd, extension: createLightCodeExtension({ dataDir, env: { ...env }, pid: 2003, ppid: 2002 }), commands: ['seq 1 3'] })
    const read = (sessionId: string) => readJournals([dataDir], { host: 'pi', sessionId })
    for (const run of [first, second, later]) expect(read(run.sessionId).filter(record => record.type === 'session/subagent')).toEqual([])
    expect(collectSubagents(read, first.sessionId).sessions).toEqual([])
  })

  it('records previews without changing anything in observe mode', async () => {
    const cwd = workspace(), dataDir = temp()
    const raw = spawnSync('/bin/sh', ['-c', 'grep -rn value src'], { cwd, encoding: 'utf8' }).stdout
    const run = await runPi({ cwd, extension: createLightCodeExtension({ dataDir, env: { LIGHTCODE_ECONOMY: 'observe' } }), commands: ['grep -rn value src'] })
    expect(textOf(run.seen[0]![0])).toBe(raw)
    expect(new FileJournal(dataDir).read({ host: 'pi', sessionId: run.sessionId })).toMatchObject([{ outcome: 'previewed', filter: 'grep' }])
  })
})
