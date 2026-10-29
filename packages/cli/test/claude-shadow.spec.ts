import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { claudeSpan, CLAUDE_RECALL_TOOL } from '../src/claude-shadow.ts'

// Each test starts real `tokenwise` processes; under a full parallel run they take longer than the default 5 s.
vi.setConfig({ testTimeout: 30_000 })

const main = fileURLToPath(new URL('../src/main.ts', import.meta.url))
const dirs: string[] = []
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'tokenwise-cc-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function hook(input: object, home: string) {
  // As Claude Code runs it: no Grok or CodeBuddy markers in the environment.
  const { GROK_HOOK_EVENT: _grok, CODEBUDDY_SESSION_ID: _codebuddy, ...env } = process.env
  const result = spawnSync(process.execPath, ['--conditions=source', main, 'hook', 'claude'], {
    input: JSON.stringify(input), encoding: 'utf8', env: { ...env, TOKENWISE_HOME: home },
  })
  return { status: result.status, out: result.stdout.trim() }
}
function tokenwise(args: string[], home: string) {
  return spawnSync(process.execPath, ['--conditions=source', main, ...args], { encoding: 'utf8', env: { ...process.env, TOKENWISE_HOME: home } }).stdout
}

// Line shapes as Claude Code 2.1.312 writes them (see claude-shadow.ts).
let n = 0
const uuid = () => `u-${++n}`
const user = (text: string) => ({ type: 'user', uuid: uuid(), isSidechain: false, message: { role: 'user', content: text } })
const toolUse = (id: string, name: string, input: object) => ({ type: 'assistant', uuid: uuid(), isSidechain: false,
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } })
const toolResult = (id: string, content: unknown, extra: object = {}) => ({ type: 'user', uuid: uuid(), isSidechain: false, ...extra,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } })
const said = (text: string) => ({ type: 'assistant', uuid: uuid(), isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text }] } })
const boundary = (preserved: string[] = []) => ({ type: 'system', subtype: 'compact_boundary', uuid: uuid(), parentUuid: null,
  compactMetadata: { trigger: 'auto', preTokens: 1, postTokens: 1, ...preserved.length ? { preservedMessages: { anchorUuid: preserved[0], uuids: preserved, allUuids: preserved } } : {} } })
const summary = (text: string) => ({ type: 'user', uuid: uuid(), isSidechain: false, isCompactSummary: true, isVisibleInTranscriptOnly: true, message: { role: 'user', content: text } })
const noise = { type: 'api-request-blob', message: { content: [{ type: 'tool_use', id: 'blob', name: 'Agent', input: {} }] } }

const log = (tag: string, rows = 400) => Array.from({ length: rows }, (_, i) => `${tag} ${i}: ${(i * 7919) % 10007}`).join('\n')
const write = (path: string, lines: object[]) => writeFileSync(path, lines.map(line => JSON.stringify(line)).join('\n') + '\n')
const catalogOf = (out: string) => JSON.parse(out).hookSpecificOutput.additionalContext as string
const ids = (text: string) => [...text.matchAll(/observation_id: (o-[a-f0-9]{12})/gu)].map(match => match[1]!)

describe('Claude Code transcript span', () => {
  it('takes the previous compaction\'s kept lines and everything after its boundary, pairing calls and results by id', () => {
    const kept = toolResult('t0', 'kept result')
    const lines = [user('old'), toolUse('t0', 'Read', { file_path: '/a.txt' }), kept, boundary([kept.uuid]), summary('Earlier: read a.txt'),
      noise, user('Now run it'), toolUse('t1', 'Bash', { command: 'make test' }), toolResult('t1', [{ type: 'text', text: 'ok 1' }, { type: 'text', text: 'ok 2' }]),
      { type: 'user', uuid: uuid(), isSidechain: true, message: { content: 'sidechain' } }, said('Done.')]
    expect(claudeSpan(lines)).toEqual([
      { role: 'tool', text: 'kept result', toolName: 'tool', callId: 't0' },
      { role: 'summary', text: 'Earlier: read a.txt' },
      { role: 'user', text: 'Now run it' },
      { role: 'assistant', text: 'Bash {"command":"make test"}' },
      { role: 'tool', text: 'ok 1\nok 2', toolName: 'Bash', callId: 't1', call: 'make test' },
      { role: 'assistant', text: 'Done.' },
    ])
  })
})

describe('tokenwise hook claude: LightShadow', () => {
  it('adds the catalog after each compaction, keeps earlier references, and tokenwise recall reads them', () => {
    const home = temp(), dir = temp(), transcript = join(dir, 's1.jsonl')
    const first = [user('Check the logs'), toolUse('t1', 'Bash', { command: 'cat alpha.log' }), toolResult('t1', log('alpha'))]
    write(transcript, first)
    const start = { hook_event_name: 'SessionStart', source: 'compact', session_id: 's1', transcript_path: transcript, cwd: dir }
    const one = catalogOf(hook(start, home).out)
    expect(one).toContain(CLAUDE_RECALL_TOOL)
    expect(one).toContain('call: "cat alpha.log"')
    expect(ids(one)).toHaveLength(1)
    write(transcript, [...first, boundary(), summary('Read alpha.log'), toolUse('t2', 'Bash', { command: 'cat beta.log' }), toolResult('t2', log('beta'))])
    const two = catalogOf(hook(start, home).out)
    expect(ids(two)).toHaveLength(2)
    expect(tokenwise(['recall', ids(two)[0]!, '--query', 'alpha 250:', '--session', 's1'], home)).toContain(`alpha 250: ${(250 * 7919) % 10007}`)
    expect(JSON.parse(tokenwise(['report', '--host', 'claude', '--json'], home)).lightshadow).toMatchObject({ assisted: 2, references: 2 })
  })

  it('keeps the whole text of an output Claude Code moved to a file', () => {
    const home = temp(), dir = temp(), transcript = join(dir, 's2.jsonl'), saved = join(dir, 'tool-results.txt')
    writeFileSync(saved, log('gamma', 3000))
    write(transcript, [toolUse('t1', 'Bash', { command: 'cat gamma.log' }),
      toolResult('t1', `<persisted-output>\nOutput too large. Full output saved to: ${saved}\nPreview:\ngamma 0: 0\n</persisted-output>`,
        { toolUseResult: { stdout: 'gamma 0', persistedOutputPath: saved, persistedOutputSize: 1 } })])
    const catalog = catalogOf(hook({ hook_event_name: 'SessionStart', source: 'compact', session_id: 's2', transcript_path: transcript }, home).out)
    expect(tokenwise(['recall', ids(catalog)[0]!, '--query', 'gamma 2999:'], home)).toContain('gamma 2999:')
  })

  it('catalogs the subagent\'s transcript when a subagent compacted', () => {
    const home = temp(), dir = temp(), transcript = join(dir, 's3.jsonl')
    write(transcript, [user('Delegate'), toolUse('agent-1', 'Agent', { prompt: 'look' })])
    mkdirSync(join(dir, 's3', 'subagents'), { recursive: true })
    write(join(dir, 's3', 'subagents', 'agent-x.jsonl'), [toolUse('t9', 'Bash', { command: 'cat delta.log' }), toolResult('t9', log('delta'))])
    const catalog = catalogOf(hook({ hook_event_name: 'SessionStart', source: 'compact', session_id: 's3', transcript_path: transcript }, home).out)
    expect(catalog).toContain('cat delta.log')
    // A running subagent without a transcript cannot be told apart: no catalog rather than the wrong one.
    rmSync(join(dir, 's3'), { recursive: true })
    expect(hook({ hook_event_name: 'SessionStart', source: 'compact', session_id: 's3', transcript_path: transcript }, home).out).toBe('')
  })

  it('stays under Claude Code\'s 10,000-character limit for added context', () => {
    const home = temp(), dir = temp(), transcript = join(dir, 's4.jsonl')
    write(transcript, Array.from({ length: 120 }, (_, i) => [toolUse(`t${i}`, 'Bash', { command: `cat part-${i}.log` }), toolResult(`t${i}`, log(`p${i}`, 60))]).flat())
    const catalog = catalogOf(hook({ hook_event_name: 'SessionStart', source: 'compact', session_id: 's4', transcript_path: transcript }, home).out)
    expect(catalog.length).toBeLessThanOrEqual(9000)
    expect(ids(catalog).length).toBeGreaterThan(40)
    expect(catalog).toContain('cat part-119.log')
  })

  it('shapes the summary, allows its own recall tool, and leaves other hosts\' events and sources alone', () => {
    const home = temp()
    expect(hook({ hook_event_name: 'PreCompact', trigger: 'auto', session_id: 's', transcript_path: '/nope' }, home).out).toContain('Do not list observation IDs')
    expect(JSON.parse(hook({ hook_event_name: 'PreToolUse', tool_name: CLAUDE_RECALL_TOOL, tool_input: {} }, home).out).hookSpecificOutput)
      .toMatchObject({ permissionDecision: 'allow' })
    expect(hook({ hook_event_name: 'PreToolUse', tool_name: 'mcp__other__tool', tool_input: {} }, home).out).toBe('')
    expect(hook({ hook_event_name: 'SessionStart', source: 'startup', session_id: 's', transcript_path: '/nope' }, home).out).toBe('')
    expect(hook({ hook_event_name: 'SessionStart', source: 'compact', session_id: 's', transcript_path: '/does/not/exist.jsonl' }, home)).toMatchObject({ status: 0, out: '' })
    expect(hook({ hookEventName: 'PreCompact', hook_event_name: 'PreCompact' }, home).out).toBe('')
  })
})
