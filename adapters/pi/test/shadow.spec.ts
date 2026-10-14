import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileJournal } from '@lightcode/store'
import type { JournalRecord, ShadowCheckpointRecord } from '@lightcode/protocol'
import { createLightCodeExtension } from '../src/extension.ts'
import type { PiShadowOptions } from '../src/shadow.ts'
import { fauxAssistantMessage, fauxToolCall, runPiWithCompaction, textOf } from './harness.ts'

const dirs: string[] = []
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'lightcode-pi-shadow-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function workspace() {
  const cwd = temp()
  mkdirSync(join(cwd, 'src'))
  for (let f = 0; f < 3; f++) writeFileSync(join(cwd, 'src', `f${f}.ts`), Array.from({ length: 90 }, (_, i) => `export const value${i} = ${i} // value line`).join('\n') + '\n')
  return cwd
}

type Summarize = NonNullable<PiShadowOptions['summarize']>
type Prep = Parameters<Summarize>[0]

/** Stands in for pi's summarizer; records what it was asked to summarize. */
function fakeSummarizer(summary = 'We ran seq and grep while fixing retry_backoff.') {
  const calls: { prep: Prep; instructions: string | undefined }[] = []
  const summarize: Summarize = async (prep, _model, _key, _headers, instructions) => {
    calls.push({ prep, instructions })
    return { summary, firstKeptEntryId: prep.firstKeptEntryId, tokensBefore: prep.tokensBefore, details: { readFiles: [], modifiedFiles: ['src/f0.ts'] } }
  }
  return { calls, summarize }
}

const catalogId = (messages: { role: string; content: unknown }[]) => {
  for (const message of messages) {
    const text = typeof message.content === 'string' ? message.content : textOf(message.content)
    const match = /observation_id: (o-[a-f0-9]{12}) \| tool: bash \| bytes: (\d+)(?! \| original)/.exec(text)
    if (match) return match[1]!
  }
  return undefined
}

describe('LightShadow on pi (real pi 1.1 session, faux model)', () => {
  it('compacts into summary + exact user messages + catalog, and the model recalls a removed result', async () => {
    const cwd = workspace(), dataDir = temp()
    const fake = fakeSummarizer()
    let recalled = ''
    const run = await runPiWithCompaction({
      cwd, extension: createLightCodeExtension({ dataDir, env: {}, summarize: fake.summarize }),
      before: ['seq 1 3000', 'grep -rn value src'],
      after: [
        context => {
          const id = catalogId(context.messages)
          if (!id) throw new Error('no catalog in the compacted context')
          return fauxAssistantMessage(fauxToolCall('lightcode_recall', { observation_id: id, query: '2500' }), { stopReason: 'toolUse' })
        },
        context => {
          recalled = textOf(context.messages.at(-1)!.content)
          return fauxAssistantMessage('done')
        },
      ],
    })

    // pi's summarizer got the segment with the results in full (so the summary keeps their findings), plus LightShadow's instruction.
    expect(fake.calls).toHaveLength(1)
    const prep = fake.calls[0]!.prep
    const sent = [...prep.messagesToSummarize, ...prep.turnPrefixMessages].filter(message => message.role === 'toolResult').map(message => textOf(message.content))
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.some(text => text.startsWith('[recoverable observation]'))).toBe(false)
    expect(fake.calls[0]!.instructions).toContain('findings')
    expect(fake.calls[0]!.instructions).toContain('recall tool')

    // The checkpoint: pi's summary, the user's words verbatim, the catalog; the file tracking pi keeps in details survives.
    const compaction = run.compaction as { summary: string; details: Record<string, any> }
    expect(compaction.summary).toContain('We ran seq and grep while fixing retry_backoff.')
    expect(compaction.summary).toContain('"Fix the KeyError in retry_backoff. Do not change the public API."')
    expect(compaction.summary).toContain('<lightcode-observation-catalog>')
    expect(compaction.details.modifiedFiles).toEqual(['src/f0.ts'])
    expect(compaction.details.lightshadow.references).toHaveLength(2)
    // The Economy-projected grep links to its complete original.
    expect(compaction.details.lightshadow.references.filter((ref: { original?: unknown }) => ref.original)).toHaveLength(1)

    // The recall tool became active and returned the window around the query, exactly as the model first read it.
    expect(run.activeTools).toContain('lightcode_recall')
    expect(recalled).toMatch(/^\[o-[a-f0-9]{12}: lines \d+-\d+ of \d+\]/)
    expect(recalled).toContain('\n2500\n')

    const records = new FileJournal(dataDir).read({ host: 'pi', sessionId: run.sessionId }) as JournalRecord[]
    expect(records.filter(record => record.type === 'shadow/checkpoint')).toMatchObject([{ kind: 'lightshadow', userMessages: 1 }])
    expect(records.filter(record => record.type === 'shadow/recall')).toMatchObject([{ outcome: 'window', original: false }])
    // pi's session file keeps the compaction entry with LightShadow's details for forks and resumes.
    const entries = readFileSync(run.sessionFile, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, any>)
    expect(entries.find(entry => entry.type === 'compaction')!.details.lightshadow.version).toBe(1)
  })

  it('leaves the compaction to pi when the checkpoint would not be smaller', async () => {
    const cwd = workspace(), dataDir = temp()
    const fake = fakeSummarizer('x'.repeat(200_000))
    const run = await runPiWithCompaction({
      cwd, extension: createLightCodeExtension({ dataDir, env: {}, summarize: fake.summarize }),
      before: ['seq 1 3000'], after: [() => fauxAssistantMessage('done')],
    })
    // pi's own summarizer (the faux model) wrote this one.
    expect((run.compaction as { summary: string }).summary).not.toContain('<lightcode-observation-catalog>')
    expect(run.activeTools).not.toContain('lightcode_recall')
    const records = new FileJournal(dataDir).read({ host: 'pi', sessionId: run.sessionId }) as ShadowCheckpointRecord[]
    expect(records.filter(record => record.type === 'shadow/checkpoint')).toMatchObject([{ kind: 'standard', reason: 'checkpoint-not-smaller' }])
  })

  it('leaves the compaction to pi when the summarizer fails, and does nothing when switched off', async () => {
    const cwd = workspace(), dataDir = temp()
    const failing: Summarize = async () => { throw new Error('provider down') }
    const run = await runPiWithCompaction({
      cwd, extension: createLightCodeExtension({ dataDir, env: {}, summarize: failing }),
      before: ['seq 1 3000'], after: [() => fauxAssistantMessage('done')],
    })
    expect((run.compaction as { summary: string }).summary).not.toContain('<lightcode-observation-catalog>')
    expect((new FileJournal(dataDir).read({ host: 'pi', sessionId: run.sessionId }) as ShadowCheckpointRecord[])
      .filter(record => record.type === 'shadow/checkpoint')).toMatchObject([{ kind: 'standard', reason: 'error' }])

    const off = temp()
    const fake = fakeSummarizer()
    const quiet = await runPiWithCompaction({
      cwd, extension: createLightCodeExtension({ dataDir: off, env: { LIGHTCODE_LIGHTSHADOW: 'off' }, summarize: fake.summarize }),
      before: ['seq 1 3000'], after: [() => fauxAssistantMessage('done')],
    })
    expect(fake.calls).toHaveLength(0)
    expect((new FileJournal(off).read({ host: 'pi', sessionId: quiet.sessionId })).filter(record => record.type === 'shadow/checkpoint')).toEqual([])
  })

  it('records what a checkpoint would keep in observe mode and leaves pi\'s compaction unchanged', async () => {
    const cwd = workspace(), dataDir = temp()
    const fake = fakeSummarizer()
    const run = await runPiWithCompaction({
      cwd, extension: createLightCodeExtension({ dataDir, env: { LIGHTCODE_LIGHTSHADOW: 'observe' }, summarize: fake.summarize }),
      before: ['seq 1 3000'], after: [() => fauxAssistantMessage('done')],
    })
    expect(fake.calls).toHaveLength(0)
    expect((run.compaction as { summary: string }).summary).not.toContain('<lightcode-observation-catalog>')
    const records = new FileJournal(dataDir).read({ host: 'pi', sessionId: run.sessionId }) as ShadowCheckpointRecord[]
    expect(records.filter(record => record.type === 'shadow/checkpoint')).toMatchObject([{ kind: 'standard', reason: 'observe' }])
    expect(records.find(record => record.type === 'shadow/checkpoint')!.references).toEqual([])
  })

  it('refuses observation IDs no checkpoint on this branch lists', async () => {
    const cwd = workspace(), dataDir = temp()
    const fake = fakeSummarizer()
    let answer = ''
    await runPiWithCompaction({
      cwd, extension: createLightCodeExtension({ dataDir, env: {}, summarize: fake.summarize }),
      before: ['seq 1 3000'],
      after: [
        () => fauxAssistantMessage(fauxToolCall('lightcode_recall', { observation_id: 'o-0123456789ab' }), { stopReason: 'toolUse' }),
        context => { answer = textOf(context.messages.at(-1)!.content); return fauxAssistantMessage('done') },
      ],
    })
    expect(answer).toMatch(/^recall failed: unknown observation_id o-0123456789ab/)
  })
})
