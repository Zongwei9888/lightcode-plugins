import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleMcp } from '../src/mcp.ts'

// Each test starts real `lc` processes; under a full parallel run they take longer than the default 5 s.
vi.setConfig({ testTimeout: 30_000 })

const main = fileURLToPath(new URL('../src/main.ts', import.meta.url))
const dirs: string[] = []
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'lightcode-shadow-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function lc(args: string[], home: string, input?: string, env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(process.execPath, ['--conditions=source', main, ...args], {
    input, encoding: 'utf8', env: { ...process.env, LIGHTCODE_HOME: home, ...env },
  })
  return { status: result.status, out: result.stdout, err: result.stderr }
}

const log = Array.from({ length: 500 }, (_, i) => `row ${i}: checksum ${(i * 7919) % 10007}`).join('\n')
const messages = [
  { role: 'user', text: 'Check the export.' },
  { role: 'assistant', text: 'Reading export.csv' },
  { role: 'tool', text: log, tool_name: 'Bash', call_id: 'toolu_1', call: 'cat export.csv' },
]

describe('lc shadow', () => {
  it('prints the summary instruction and the tool declaration', () => {
    const home = temp()
    expect(lc(['shadow', 'instruction'], home).out).toContain('recall tool')
    expect(JSON.parse(lc(['shadow', 'tool'], home).out)).toMatchObject({ name: 'lightcode_recall' })
  })

  it('catalog: keeps the span recallable for the session, then lc recall reads it', () => {
    const home = temp()
    const result = JSON.parse(lc(['shadow', 'catalog'], home, JSON.stringify({ host: 'claude', session_id: 's1', messages, tool_name: 'mcp__lightcode__lightcode_recall' })).out)
    expect(result).toMatchObject({ references: 1, added: 1 })
    expect(result.text).toContain('mcp__lightcode__lightcode_recall')
    const id = /observation_id: (o-[a-f0-9]{12})/u.exec(result.text)![1]!
    const recall = lc(['recall', id, '--query', 'row 321:', '--session', 's1', '--host', 'claude'], home)
    expect(recall.status).toBe(0)
    expect(recall.out).toContain(`row 321: checksum ${(321 * 7919) % 10007}`)
    // Without the session it is still found (IDs are content hashes).
    expect(lc(['recall', id, '--line', '10'], home).out).toContain('row 9:')
    const failed = lc(['recall', 'o-000000000000'], home)
    expect(failed.status).toBe(1)
    expect(failed.out).toContain('unknown observation_id')
    const report = JSON.parse(lc(['report', '--json'], home).out)
    expect(report.lightshadow).toMatchObject({ assisted: 1, references: 1, recalls: 3, failedRecalls: 1 })
  })

  it('checkpoint: returns the checkpoint text, or null with a reason', () => {
    const home = temp()
    const ok = JSON.parse(lc(['shadow', 'checkpoint'], home, JSON.stringify({ host: 'hermes', session_id: 's1', messages, summary: 'Export has 500 rows.' })).out)
    expect(ok.text).toMatch(/^Export has 500 rows\./u)
    expect(ok.text).toContain('<lightcode-observation-catalog>')
    expect(JSON.parse(lc(['shadow', 'checkpoint'], home, JSON.stringify({ host: 'hermes', messages })).out)).toMatchObject({ text: null, error: 'summary is required' })
    expect(JSON.parse(lc(['shadow', 'checkpoint'], home, 'not json').out).text).toBeNull()
    const off = lc(['shadow', 'catalog'], home, JSON.stringify({ host: 'claude', messages }), { LIGHTCODE_LIGHTSHADOW: 'off' })
    expect(JSON.parse(off.out).text).toBeNull()
  })
})

describe('lc mcp', () => {
  it('answers initialize, tools/list and tools/call over stdio', () => {
    const home = temp()
    const catalog = JSON.parse(lc(['shadow', 'catalog'], home, JSON.stringify({ host: 'codex', session_id: 's9', messages })).out)
    const id = /observation_id: (o-[a-f0-9]{12})/u.exec(catalog.text)![1]!
    const input = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'lightcode_recall', arguments: { observation_id: id, query: 'row 42:' } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'lightcode_recall', arguments: {} } },
      { jsonrpc: '2.0', id: 5, method: 'nope' },
    ].map(item => JSON.stringify(item)).join('\n') + '\n'
    const replies = lc(['mcp', '--host', 'codex'], home, input).out.trim().split('\n').map(line => JSON.parse(line))
    expect(replies.map(reply => reply.id)).toEqual([1, 2, 3, 4, 5])
    expect(replies[0].result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'lightcode' }, capabilities: { tools: {} } })
    expect(replies[1].result.tools[0]).toMatchObject({ name: 'lightcode_recall', inputSchema: { required: ['observation_id'] } })
    expect(replies[2].result).toMatchObject({ isError: false })
    expect(replies[2].result.content[0].text).toContain(`row 42: checksum ${(42 * 7919) % 10007}`)
    expect(replies[3].result.isError).toBe(true)
    expect(replies[4].error.code).toBe(-32601)
  })

  it('offers the newest protocol version to a client asking for an unknown one', () => {
    const reply = handleMcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } })
    expect((reply!.result as { protocolVersion: string }).protocolVersion).toBe('2025-11-25')
    expect(handleMcp({ jsonrpc: '2.0', method: 'notifications/cancelled' })).toBeUndefined()
  })
})

describe('lc shadow checkpoint for hosts that keep the user messages themselves', () => {
  it('leaves the user messages out and lists each reference with its call', () => {
    const home = temp()
    const out = JSON.parse(lc(['shadow', 'checkpoint'], home, JSON.stringify({ host: 'hermes', session_id: 's1', messages, summary: 'Export has 500 rows.', user_messages: false })).out)
    expect(out.text).not.toContain('Check the export.')
    expect(out.refs).toEqual([{ id: expect.stringMatching(/^o-[a-f0-9]{12}$/u), call_id: 'toolu_1' }])
  })
})
