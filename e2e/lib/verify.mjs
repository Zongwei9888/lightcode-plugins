/**
 * Checks shared by every host: what the model received must be exactly what
 * TokenWise journaled (the projection, or the untouched original), and every
 * projected original must be recoverable from the private store.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { toolResults } from './mock-llm.mjs'

const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex')

export function journal(tokenwiseHome, host) {
  const dir = join(tokenwiseHome, 'journal', host)
  if (!existsSync(dir)) return []
  // One file per session: merge them in time order.
  return readdirSync(dir).filter(name => name.endsWith('.jsonl'))
    .flatMap(name => readFileSync(join(dir, name), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)))
    .sort((a, b) => a.time.localeCompare(b.time))
}

export function artifact(tokenwiseHome, hash) {
  return readFileSync(join(tokenwiseHome, 'artifacts', hash.slice(0, 2), `${hash}.txt`), 'utf8')
}

/** The tool results of the last request that still offered tools: the whole scripted conversation. */
export function delivered(requests) {
  const last = requests.filter(request => Array.isArray(request.tools) && request.tools.length > 0).at(-1)
  assert.ok(last, 'the host never sent a request with tools')
  return toolResults(last)
}

/**
 * DeepSeek Harness's spill policy bounds results over its inline budget: the
 * model reads the head of the original and a notice naming the full copy.
 * When TokenWise passes a result through, that is what the model must read.
 */
export function dshSpilled(text, original) {
  const notice = text.lastIndexOf('\n\n(Omitted ')
  if (notice <= 0 || !/Full formatted result stored at: /.test(text.slice(notice))) return false
  // The preview is the head and the tail of the original around a `[...]` gap.
  const [head, tail, ...rest] = text.slice(0, notice).split('\n\n[...]\n\n')
  return rest.length === 0 && head !== undefined && tail !== undefined && head.length > 0
    && original.startsWith(head) && original.trimEnd().endsWith(tail.trimEnd()) && head.length + tail.length < original.length
}

/**
 * @param {{ requests: any[], tokenwiseHome: string, host: string, commands: string[],
 *   expect: ('projected' | 'previewed' | 'passed')[], evidence?: Record<number, string[]>,
 *   hostBounded?: { original: (command: string) => string | undefined, accepts: (text: string, original: string) => boolean } }} options
 */
export function verifyDeliveries({ requests, tokenwiseHome, host, commands, expect, evidence = {}, hostBounded }) {
  const results = delivered(requests)
  assert.equal(results.length, commands.length, `expected ${commands.length} tool results, the model received ${results.length}`)
  const all = journal(tokenwiseHome, host)
  const records = all.filter(record => record.type === 'economy/decision')
  // Hosts that normalize commands before running them journal the decision under the command that ran.
  const ran = new Map(all.filter(record => record.type === 'economy/command-rewrite').map(record => [record.original, record.rewritten]))
  const summary = []
  for (const [index, command] of commands.entries()) {
    // Sessions run one after another, so the latest decision for a command belongs to this one.
    const record = records.findLast(item => item.command === (ran.get(command) ?? command))
    assert.ok(record, `no TokenWise decision for \`${command}\``)
    assert.equal(record.outcome, expect[index], `\`${command}\`: expected ${expect[index]}, got ${record.outcome} (${record.reason ?? ''} ${record.matchDetail ?? ''})`)
    const text = results[index].text
    if (record.outcome === 'projected') {
      assert.equal(sha256(text), record.projected.sha256, `\`${command}\`: the model did not receive the journaled projection`)
      const original = artifact(tokenwiseHome, record.raw.sha256)
      assert.equal(sha256(original), record.raw.sha256)
      assert.ok(text.length < original.length, `\`${command}\`: projection is not smaller`)
      summary.push({ command, outcome: 'projected', filter: record.filter, rawTokens: record.raw.tokens, projectedTokens: record.projected.tokens })
    } else if (sha256(text) !== record.raw.sha256) {
      // Passed through: only the host's own bounding of the very same original may change it.
      const original = hostBounded?.original(command)
      assert.ok(original !== undefined && sha256(original) === record.raw.sha256 && hostBounded.accepts(text, original),
        `\`${command}\`: the model did not receive the original (${text.length} chars delivered)`)
      summary.push({ command, outcome: record.outcome, filter: record.filter, rawTokens: record.raw.tokens, projectedTokens: record.projected?.tokens, bounded: true })
    } else {
      summary.push({ command, outcome: record.outcome, filter: record.filter, rawTokens: record.raw.tokens, projectedTokens: record.projected?.tokens })
    }
    for (const needle of evidence[index] ?? []) assert.ok(text.includes(needle), `\`${command}\`: delivered text lost ${JSON.stringify(needle)}`)
  }
  return summary
}
