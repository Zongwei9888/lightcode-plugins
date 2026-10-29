import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RECALL_INPUT_SCHEMA } from '@tokenwise/mechanisms'
import { createTokenWise } from '../src/plugin.ts'
import type { Hooks } from '../src/plugin.ts'
import { shadowMessagesOf } from '../src/shadow.ts'
import type { OpenCodeClient, OpenCodeMessage } from '../src/shadow.ts'

const dirs: string[] = []
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'tokenwise-oc-shadow-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const rows = (tag: string) => Array.from({ length: 400 }, (_, i) => `${tag} ${i}: ${(i * 7919) % 10007}`).join('\n')
// Messages and parts as OpenCode 1.19.4 hands them to experimental.chat.messages.transform.
const span = (sessionID: string): OpenCodeMessage[] => [
  { info: { id: 'm1', sessionID, role: 'user' }, parts: [{ type: 'text', text: 'Read both data files.' }, { type: 'text', text: 'synthetic note', synthetic: true }] },
  { info: { id: 'm2', sessionID, role: 'assistant' }, parts: [
    { type: 'text', text: 'Reading them.' },
    { type: 'tool', tool: 'read', callID: 'call_1', state: { status: 'completed', input: { filePath: '/w/data1.txt' }, output: rows('one') } },
    { type: 'tool', tool: 'bash', callID: 'call_2', state: { status: 'completed', input: { command: 'cat data2.txt' }, output: rows('two'), time: { compacted: 1 } } },
    { type: 'tool', tool: 'bash', callID: 'call_3', state: { status: 'error', input: { command: 'false' } } },
  ] },
]

async function plugin(client?: OpenCodeClient, env: NodeJS.ProcessEnv = {}) {
  const errors: unknown[] = []
  const hooks: Hooks = await createTokenWise({ env: { TOKENWISE_HOME: temp(), ...env }, onError: error => errors.push(error) })({ directory: temp(), ...client ? { client } : {} })
  return { hooks, errors }
}

/** One compaction, in the order OpenCode 1.19.4 calls the hooks. */
async function compact(hooks: Hooks, sessionID: string, summary: string, messageID = 'sum1') {
  const compacting = { context: [] as string[] }
  await hooks['experimental.session.compacting']!({ sessionID }, compacting)
  await hooks['experimental.chat.messages.transform']!({}, { messages: span(sessionID) })
  const text = { text: summary }
  await hooks['experimental.text.complete']!({ sessionID, messageID, partID: 'p1' }, text)
  await hooks.event!({ event: { type: 'session.compacted', properties: { sessionID } } })
  return { compacting, text: text.text }
}

describe('OpenCode span', () => {
  it('reads user text, assistant text and completed tool results that pruning did not clear', () => {
    const messages = shadowMessagesOf(span('s'))
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    expect(messages[0]).toEqual({ role: 'user', text: 'Read both data files.' })
    expect(messages[2]).toMatchObject({ role: 'tool', toolName: 'read', callId: 'call_1', call: '/w/data1.txt' })
  })
})

describe('OpenCode LightShadow', () => {
  it('turns the compaction summary into a checkpoint, and the recall tool reads a listed result', async () => {
    const client: OpenCodeClient = { session: {
      message: async ({ path }) => ({ data: { info: { id: path.messageID, role: 'assistant', summary: true, mode: 'compaction' }, parts: [] } }),
      messages: async () => ({ data: [] }),
    } }
    const { hooks, errors } = await plugin(client)
    const { compacting, text } = await compact(hooks, 'ses_1', '## Goal\nRead the data files.')
    expect(compacting.context[0]).toContain('tool result in this span stays recoverable')
    expect(text).toMatch(/^## Goal\nRead the data files\./u)
    expect(text).toContain('"Read both data files."')
    const ids = [...text.matchAll(/observation_id: (o-[a-f0-9]{12})/gu)].map(m => m[1]!)
    expect(ids).toHaveLength(1)
    const recalled = await hooks.tool!.tokenwise_recall!.execute({ observation_id: ids[0], query: 'one 333:' }, { sessionID: 'ses_1', callID: 'c9' })
    expect(recalled).toContain(`one 333: ${(333 * 7919) % 10007}`)
    const definition = { description: 'd', parameters: {}, jsonSchema: { required: ['observation_id', 'query', 'line', 'original'] } }
    await hooks['tool.definition']!({ toolID: 'tokenwise_recall' }, definition)
    expect(definition.jsonSchema).toEqual(RECALL_INPUT_SCHEMA)
    expect(errors).toEqual([])
  })

  it('leaves normal requests, other text and other sessions alone', async () => {
    const client: OpenCodeClient = { session: { message: async () => ({ data: { info: { role: 'assistant', summary: false, mode: 'build' }, parts: [] } }) } }
    const { hooks } = await plugin(client)
    // A transform with no compaction pending is a normal request.
    const normal = { messages: span('ses_2') }
    await hooks['experimental.chat.messages.transform']!({}, normal)
    expect(normal.messages).toEqual(span('ses_2'))
    const reply = { text: 'An ordinary answer.' }
    await hooks['experimental.text.complete']!({ sessionID: 'ses_2', messageID: 'm', partID: 'p' }, reply)
    expect(reply.text).toBe('An ordinary answer.')
    // During a compaction, a text part that is not the summary keeps its text.
    const { text } = await compact(hooks, 'ses_2', 'Not the summary.')
    expect(text).toBe('Not the summary.')
  })

  it('fails open: a client that throws or hangs, and LightShadow switched off', async () => {
    const broken: OpenCodeClient = { session: { message: async () => { throw new Error('boom') }, messages: () => new Promise(() => {}) } }
    const { hooks, errors } = await plugin(broken)
    const started = Date.now()
    const { text } = await compact(hooks, 'ses_3', 'Summary.')
    // The hanging lookup gives up after its timeout; the throwing one counts as "no answer".
    expect(Date.now() - started).toBeLessThan(5000)
    expect(text).toContain('<tokenwise-observation-catalog>')
    expect(errors).toEqual([])
    const off = await plugin(undefined, { TOKENWISE_COMPACTION: 'off' })
    expect(off.hooks['experimental.session.compacting']).toBeUndefined()
    expect(off.hooks.tool).toBeUndefined()
    expect(off.hooks['tool.execute.after']).toBeDefined()
  })
})
