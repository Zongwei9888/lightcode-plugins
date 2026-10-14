/**
 * A session long enough to make a host compact, then a recall: the scripted
 * model and the checks shared by the LightShadow scenarios (shadow.mjs and the
 * Plugins page).
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { journal } from './verify.mjs'

export const SHADOW_PROMPT = 'Run the fixture commands, then recall one of them.'
/**
 * `count` results of about 7.8 KB (under DSH's 8,192-character pruning line)
 * and one of 21 KB (over it).
 */
export const seqCommands = (count = 12) => [...Array.from({ length: count }, (_, i) => `seq ${10_000 * (i + 1)} ${10_000 * (i + 1) + 1299}`), 'seq 900000 902999']
const CATALOG = /<lightcode-observation-catalog>[\s\S]*?<\/lightcode-observation-catalog>/
const SUMMARY = '## Primary Request and Intent\n- Run the fixture commands.\n\n## Current Work\n- Ran seq commands.'

const textOf = content => typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => part.text ?? '').join('') : ''
const sha = text => createHash('sha256').update(text).digest('hex')

/**
 * The model: run each command once (counting its own agent turns, since
 * compaction removes earlier tool results), then recall the first catalog
 * entry, then stop. Summarization requests get a fixed summary.
 */
export function shadowScript(commands = seqCommands()) {
  let turns = 0
  const state = { recalledId: undefined, summaries: 0 }
  const respond = request => {
    const last = request.messages.at(-1)
    const lastText = textOf(last?.content)
    if (/compaction engine|summar/i.test(lastText) && last?.role === 'user' && turns > 0 || !Array.isArray(request.tools) || request.tools.length === 0) {
      state.summaries++
      return { content: SUMMARY }
    }
    const step = turns++
    if (step < commands.length) {
      return { content: null, tool_calls: [{ id: `call_${step + 1}`, type: 'function', function: { name: 'bash', arguments: JSON.stringify({ description: 'Run a fixture command', command: commands[step] }) } }] }
    }
    if (state.recalledId === undefined) {
      const catalog = request.messages.map(message => textOf(message.content)).join('\n').match(CATALOG)?.[0]
      const id = catalog?.match(/observation_id: (o-[a-f0-9]{12}) \| tool: bash/)?.[1]
      if (!id) return { content: 'no catalog' }
      if (!request.tools.some(tool => tool.function?.name === 'lightcode_recall')) return { content: 'no recall tool' }
      state.recalledId = id
      return { content: null, tool_calls: [{ id: `call_recall`, type: 'function', function: { name: 'lightcode_recall', arguments: JSON.stringify({ observation_id: id }) } }] }
    }
    return { content: 'done' }
  }
  return { state, script: { commands: [], respond } }
}

/** What the model read for each command before compaction, and what it got back from recall. */
export function readBack(requests, recalledId, lightcodeHome, host) {
  // Every version of every tool result the model was sent (a later request may carry a cut one).
  const seen = []
  for (const request of requests) {
    for (const message of request.messages) if (message.role === 'tool') seen.push({ id: message.tool_call_id, text: textOf(message.content) })
  }
  const records = journal(lightcodeHome, host)
  const checkpoints = records.filter(record => record.type === 'shadow/checkpoint')
  const reference = checkpoints.flatMap(record => record.references).find(item => item.id === recalledId)
  assert.ok(reference, `journal has no reference ${recalledId}`)
  const first = seen.find(item => item.id !== 'call_recall' && sha(item.text) === reference.sha256)
  assert.ok(first, 'the referenced text is not a tool result the model read')
  const recalled = seen.findLast(item => item.id === 'call_recall')
  assert.equal(recalled?.text, first.text, 'recall did not return exactly what the model first read')
  return { records, checkpoints }
}

export function checkpointRequest(requests, prompt = SHADOW_PROMPT) {
  const found = requests.find(request => request.messages.some(message => CATALOG.test(textOf(message.content))))
  assert.ok(found, 'no request carried a LightShadow checkpoint')
  const text = found.messages.map(message => textOf(message.content)).find(item => CATALOG.test(item))
  assert.ok(text.includes(JSON.stringify(prompt)), 'the checkpoint lost the user\'s exact words')
  assert.ok(text.includes('Run the fixture commands.'), 'the checkpoint lost the summary')
  return text
}

