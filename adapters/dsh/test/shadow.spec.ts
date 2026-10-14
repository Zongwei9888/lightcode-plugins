import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileArtifactStore, FileJournal } from '@lightcode/store'
import type { JournalRecord, MechanismMode, ShadowCheckpointRecord } from '@lightcode/protocol'
import { DSH_PRUNE_MARKER, createDshShadow, shadowMessages } from '../src/shadow.ts'
import type { SummarizationInput, SummaryResult } from '../src/shadow.ts'

const dirs: string[] = []
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'lightcode-dsh-shadow-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const text = (value: string) => [{ type: 'text', text: value }]
const big = Array.from({ length: 3000 }, (_, i) => `${i}`).join('\n')

/** The span compaction-basic hands its summarizer: system head, then surface messages. */
function span(): SummarizationInput {
  return { tools: [], messages: [
    { role: 'system', content: text('You are DSH.'), source: { kind: 'system-prompt' } },
    { role: 'user', content: text('Fix the KeyError. Keep the API.'), source: { kind: 'user' } },
    { role: 'assistant', content: [{ type: 'text', text: 'Running seq.' }, { type: 'tool-call', id: 'call-1', name: 'bash', arguments: '{"command":"seq 3000"}' }], source: { kind: 'model' } },
    { role: 'tool', content: text(big), source: { kind: 'tool' }, toolCallId: 'call-1' },
    { role: 'user', content: text('[notice] background job finished'), source: { kind: 'notice' } },
  ] }
}

/** Stand-ins for compaction-basic and the pruner, reached the way DSH exposes them: through a listener's context. */
function fakeHost(summary = 'We ran seq 3000.') {
  const calls: SummarizationInput[] = []
  const engine = {
    async summarize(input: SummarizationInput, _agent?: unknown, _signal?: AbortSignal): Promise<SummaryResult> {
      calls.push(input)
      return { summary: text(summary), provider: 'p', model: 'm', rawOutput: text(summary), llmStreamCall: true }
    },
  }
  const pruner = {
    config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
    pruneContent(blocks: readonly { type: string; text?: unknown }[]) {
      const all = String(blocks[0]!.text)
      if (all.length <= 8192) return null
      return [{ type: 'text', text: all.slice(0, 4096) + DSH_PRUNE_MARKER + all.slice(-1024) }]
    },
    pruneSession(session: { id: string }) {
      return this.pruneContent([{ type: 'text', text: `${session.id}:${big}` }])
    },
  }
  const services: Record<string, unknown> = { compaction: engine, toolResultPruner: pruner }
  const events = { _hooks: { 'agent/pre-step': [{ ctx: { get: (name: string) => services[name] } }, { ctx: {} }] } }
  return { calls, engine, pruner, events }
}

function setup(mode: MechanismMode = 'apply') {
  const data = temp()
  const journal = new FileJournal(data), artifacts = new FileArtifactStore(data)
  const read = (sessionId: string) => journal.read({ host: 'dsh', sessionId }) as JournalRecord[]
  const warnings: string[] = []
  const shadow = createDshShadow({ host: 'dsh', mode: () => mode, journal: () => journal, artifacts: () => artifacts, read, warn: message => warnings.push(message) })
  return { shadow, read, artifacts, warnings }
}

const agent = { session: { id: 's1', header: { cwd: '/w' } } }

describe('LightShadow on DSH', () => {
  it('reads DSH messages: the system head stays out, checkpoints and notices are no user words', () => {
    const { segment, indexes } = shadowMessages([...span().messages, { role: 'user', content: text('old'), source: { kind: 'compact-checkpoint' } }])
    expect(indexes).toEqual([1, 2, 3, 4, 5])
    expect(segment.map(item => item.role)).toEqual(['user', 'assistant', 'tool', 'other', 'summary'])
    expect(segment[2]).toMatchObject({ toolName: 'bash', callId: 'call-1', text: big })
  })

  it('wraps each engine once and turns the span into a recoverable checkpoint', async () => {
    const host = fakeHost(), { shadow, read } = setup()
    shadow.discover(host.events)
    shadow.discover(host.events)
    expect(shadow.attached).toEqual({ engines: 1, pruners: 1 })
    const result = await host.engine.summarize(span(), agent as never)
    // DSH's summarizer saw the result in full (so the summary can keep its findings), and LightShadow's note.
    const sent = host.calls[0]!.messages
    expect(sent[3]).toEqual(span().messages[3])
    expect(String(sent.at(-1)!.content[0]!.text)).toContain('findings')
    expect(String(sent.at(-1)!.content[0]!.text)).toContain('recall tool')
    expect(sent[0]).toEqual(span().messages[0])
    // The checkpoint keeps DSH's envelope and adds the user's exact words and the catalog.
    expect(result).toMatchObject({ provider: 'p', model: 'm', llmStreamCall: true, rawOutput: text('We ran seq 3000.') })
    const checkpoint = String(result.summary[0]!.text)
    expect(checkpoint).toContain('We ran seq 3000.')
    expect(checkpoint).toContain('"Fix the KeyError. Keep the API."')
    expect(checkpoint).not.toContain('background job finished')
    const id = /observation_id: (o-[a-f0-9]{12})/.exec(checkpoint)![1]!
    expect(read('s1').filter(record => record.type === 'shadow/checkpoint')).toMatchObject([{ kind: 'lightshadow', userMessages: 1 }])

    const recalled = shadow.recall({ id: 's1' }, { observation_id: id, query: '2999' }, 'c9')
    expect(recalled.result).toMatchObject({ ok: true, complete: false })
    expect(recalled.text).toContain('\n2999')
    expect(read('s1').filter(record => record.type === 'shadow/recall')).toMatchObject([{ id, outcome: 'window', callId: 'c9' }])
    // Another session cannot read this session's references.
    expect(shadow.recall({ id: 's2' }, { observation_id: id, query: '2999' }, null).result.ok).toBe(false)
  })

  it('carries an earlier checkpoint\'s user words and references into the next compaction', async () => {
    const host = fakeHost(), { shadow } = setup()
    shadow.discover(host.events)
    const first = await host.engine.summarize(span(), agent as never)
    const firstId = /observation_id: (o-[a-f0-9]{12})/.exec(String(first.summary[0]!.text))![1]!
    const framed = `This is an automatically generated checkpoint...\n\n<compacted-summary>${String(first.summary[0]!.text)}</compacted-summary>`
    const second = await host.engine.summarize({ messages: [
      { role: 'user', content: text(framed), source: { kind: 'compact-checkpoint' } },
      { role: 'user', content: text('Now lint.'), source: { kind: 'user' } },
      { role: 'assistant', content: [{ type: 'tool-call', id: 'call-2', name: 'bash', arguments: '{"command":"lint"}' }], source: { kind: 'model' } },
      { role: 'tool', content: text(`lint\n${big}`), source: { kind: 'tool' }, toolCallId: 'call-2' },
    ] }, agent as never)
    const checkpoint = String(second.summary[0]!.text)
    expect(checkpoint).toContain('"Fix the KeyError. Keep the API."')
    expect(checkpoint).toContain('"Now lint."')
    expect(checkpoint).toContain(`observation_id: ${firstId}`)
    expect(checkpoint.match(/^observation_id: /gm)).toHaveLength(2)
    // The summarizer saw the earlier summary without its catalog or user-message list.
    expect(String(host.calls[1]!.messages[0]!.content[0]!.text)).not.toContain('observation_id')
  })

  it('falls back to DSH\'s own summary of the original span when the checkpoint is not smaller', async () => {
    const host = fakeHost('y'.repeat(100_000)), { shadow, read } = setup()
    shadow.discover(host.events)
    const result = await host.engine.summarize(span(), agent as never)
    expect(host.calls).toHaveLength(2)
    expect(host.calls[1]!.messages).toEqual(span().messages)
    expect(String(result.summary[0]!.text)).not.toContain('lightcode-observation-catalog')
    expect((read('s1') as ShadowCheckpointRecord[]).filter(record => record.type === 'shadow/checkpoint')).toMatchObject([{ kind: 'standard', reason: 'checkpoint-not-smaller' }])
  })

  it('hands DSH\'s summarizer errors to DSH\'s own recovery, after a single call', async () => {
    const host = fakeHost(), { shadow, warnings } = setup()
    let attempts = 0
    host.engine.summarize = async () => { attempts++; throw new Error('provider down') }
    shadow.discover(host.events)
    await expect(host.engine.summarize(span(), agent as never)).rejects.toThrow('provider down')
    expect(attempts).toBe(1)
    expect(warnings).toEqual([])
  })

  it('prices with DSH\'s token meter when the agent offers it, and skips the summary call that could not fit', async () => {
    const host = fakeHost(), { shadow, read } = setup()
    shadow.discover(host.events)
    // DSH's meter prices the span at 40 tokens and anything carrying the user-message list at 1000: no checkpoint fits.
    const estimateMessage = (message: { content: { text?: string }[] }) => message.content.some(block => block.text?.includes('User messages (verbatim)')) ? 1000 : 10
    const metered = { ...agent, ctx: { get: (name: string) => name === 'tokenMeter' ? { estimateMessage } : undefined } }
    const result = await host.engine.summarize(span(), metered as never)
    expect(host.calls).toHaveLength(1)
    expect(host.calls[0]!.messages).toEqual(span().messages)
    expect(result.summary).toEqual(text('We ran seq 3000.'))
    expect((read('s1') as ShadowCheckpointRecord[]).filter(record => record.type === 'shadow/checkpoint')).toMatchObject([{ kind: 'standard', reason: 'checkpoint-not-smaller' }])
  })

  it('leaves the span alone in observe and off modes', async () => {
    for (const mode of ['observe', 'off'] as const) {
      const host = fakeHost(), { shadow, read } = setup(mode)
      shadow.discover(host.events)
      const result = await host.engine.summarize(span(), agent as never)
      expect(host.calls[0]!.messages).toEqual(span().messages)
      expect(result.summary).toEqual(text('We ran seq 3000.'))
      expect(read('s1').filter(record => record.type === 'shadow/checkpoint')).toHaveLength(mode === 'observe' ? 1 : 0)
    }
  })

  it('keeps the complete text of a result DSH cuts, and names it in the cut', () => {
    const host = fakeHost(), { shadow, read, artifacts } = setup()
    shadow.discover(host.events)
    const pruned = host.pruner.pruneSession({ id: 's1' }) as { text: string }[]
    expect(pruned[0]!.text).not.toContain(DSH_PRUNE_MARKER)
    const id = /observation_id (o-[a-f0-9]{12})/.exec(pruned[0]!.text)![1]!
    const record = (read('s1') as ShadowCheckpointRecord[]).find(item => item.type === 'shadow/checkpoint')!
    expect(record).toMatchObject({ kind: 'cut', references: [{ id }] })
    expect(artifacts.read(record.references[0]!.sha256)).toBe(`s1:${big}`)
    expect(shadow.recall({ id: 's1' }, { observation_id: id, query: '1500' }, null).text).toContain('\n1500\n')
    // A note that would push the result over the pruner's threshold is not written.
    host.pruner.config.thresholdChars = 5150
    const tight = host.pruner.pruneSession({ id: 's1' }) as { text: string }[]
    expect(tight[0]!.text).toContain(DSH_PRUNE_MARKER)
    host.pruner.config.thresholdChars = 8192
    // Outside pruneSession (no session known), the pruner's own cut stands.
    expect(host.pruner.pruneContent([{ type: 'text', text: big }])![0]!.text).toContain(DSH_PRUNE_MARKER)
  })

  it('ignores a listener list it does not recognize', () => {
    const { shadow } = setup()
    for (const events of [undefined, {}, { _hooks: {} }, { _hooks: { 'agent/pre-step': 'x' } }, { _hooks: { 'agent/pre-step': [{ ctx: { get: () => { throw new Error('inactive') } } }] } }]) {
      expect(() => shadow.discover(events)).not.toThrow()
    }
    expect(shadow.attached).toEqual({ engines: 0, pruners: 0 })
  })
})
