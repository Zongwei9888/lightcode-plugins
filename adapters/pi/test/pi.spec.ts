import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileArtifactStore, FileJournal } from '@lightcode/store'
import type { EconomyRecord, JournalRecord } from '@lightcode/protocol'
import { createLightCodeExtension } from '../src/extension.ts'
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

describe('pi adapter (real pi 1.1 session, faux model)', () => {
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

  it('records previews without changing anything in observe mode', async () => {
    const cwd = workspace(), dataDir = temp()
    const raw = spawnSync('/bin/sh', ['-c', 'grep -rn value src'], { cwd, encoding: 'utf8' }).stdout
    const run = await runPi({ cwd, extension: createLightCodeExtension({ dataDir, env: { LIGHTCODE_ECONOMY: 'observe' } }), commands: ['grep -rn value src'] })
    expect(textOf(run.seen[0]![0])).toBe(raw)
    expect(new FileJournal(dataDir).read({ host: 'pi', sessionId: run.sessionId })).toMatchObject([{ outcome: 'previewed', filter: 'grep' }])
  })
})
