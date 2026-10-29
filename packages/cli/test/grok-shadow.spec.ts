import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GROK_RECALL_TOOL, grokSpan, grokSpanFromUpdates } from '../src/grok-shadow.ts'

// Each test starts real `tokenwise` processes; under a full parallel run they take longer than the default 5 s.
vi.setConfig({ testTimeout: 30_000 })

const main = fileURLToPath(new URL('../src/main.ts', import.meta.url))
const dirs: string[] = []
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'tokenwise-grok-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function hook(input: object, home: string) {
  const result = spawnSync(process.execPath, ['--conditions=source', main, 'hook', 'grok'], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, TOKENWISE_HOME: home } })
  return result.stdout.trim()
}
const tokenwise = (args: string[], home: string) =>
  spawnSync(process.execPath, ['--conditions=source', main, ...args], { encoding: 'utf8', env: { ...process.env, TOKENWISE_HOME: home } }).stdout

const rows = (tag: string) => Array.from({ length: 400 }, (_, i) => `${tag} ${i}: ${(i * 7919) % 10007}`).join('\n')
// chat_history rows as Grok 1.0.70 writes them into compaction_requests/<id>.json.
const history = [
  { type: 'system', content: 'You are Grok.' },
  { type: 'user', content: [{ type: 'text', text: '<user_info>OS</user_info>' }] },
  { type: 'user', content: [{ type: 'text', text: '<system-reminder>skills</system-reminder>' }], synthetic_reason: 'system_reminder' },
  { type: 'user', content: [{ type: 'text', text: '<user_query>\nRead the logs\n</user_query>' }], prompt_index: 0 },
  { type: 'assistant', content: 'Reading.', tool_calls: [{ id: 'call-a-0', name: 'run_terminal_command', arguments: '{"command":"cat alpha.log"}' }] },
  { type: 'tool_result', tool_call_id: 'call-a-0', content: `exit: 0\n${rows('alpha')}` },
  { type: 'user', content: [{ type: 'text', text: 'Your task is to produce a faithful, concise summary' }] },
]

function session(home: string) {
  const dir = join(temp(), 'sessions', 'ws', 'gk-1')
  mkdirSync(join(dir, 'compaction_requests'), { recursive: true })
  writeFileSync(join(dir, 'compaction_requests', 'r1.json'), JSON.stringify({ schema_version: 1, trigger: 'manual', chat_history: history, summary: 'S', error: null }))
  const base = { sessionId: 'gk-1', session_id: 'gk-1', cwd: home, transcriptPath: join(dir, 'updates.jsonl'), transcript_path: join(dir, 'updates.jsonl') }
  return base
}

describe('Grok compaction span', () => {
  it('reads real prompts (with prompt_index), replies and tool results with their calls', () => {
    expect(grokSpan(history)).toEqual([
      { role: 'user', text: '<user_query>\nRead the logs\n</user_query>' },
      { role: 'assistant', text: 'Reading.\nrun_terminal_command {"command":"cat alpha.log"}' },
      { role: 'tool', text: `exit: 0\n${rows('alpha')}`, toolName: 'run_terminal_command', callId: 'call-a-0', call: 'cat alpha.log' },
    ])
  })
})

describe('tokenwise hook grok: LightShadow', () => {
  it('keeps the catalog after PostCompact and adds it to the next tool result, once', () => {
    const home = temp(), base = session(home)
    expect(hook({ ...base, hookEventName: 'post_compact', hook_event_name: 'PostCompact', source: 'manual' }, home)).toBe('')
    const next = { ...base, hookEventName: 'post_tool_use', hook_event_name: 'PostToolUse', toolName: 'read_file', tool_name: 'read_file', toolUseId: 'c2', tool_use_id: 'c2' }
    const delivered = JSON.parse(hook(next, home)).hookSpecificOutput
    expect(delivered.hookEventName).toBe('PostToolUse')
    expect(delivered.additionalContext).toContain(`use_tool with tool_name "${GROK_RECALL_TOOL}"`)
    expect(delivered.additionalContext).toContain('call: "cat alpha.log"')
    expect(delivered.updatedToolOutput).toBeUndefined()
    expect(hook(next, home)).toBe('')
    const id = /observation_id: (o-[a-f0-9]{12})/u.exec(delivered.additionalContext)![1]!
    expect(tokenwise(['recall', id, '--query', 'alpha 301:'], home)).toContain(`alpha 301: ${(301 * 7919) % 10007}`)
  })

  it('delivers it at Stop when the turn used no tool, and not at a session-end Stop', () => {
    const home = temp(), base = session(home)
    hook({ ...base, hook_event_name: 'PostCompact', source: 'auto' }, home)
    expect(hook({ ...base, hook_event_name: 'Stop', reason: 'shutdown' }, home)).toBe('')
    const stop = JSON.parse(hook({ ...base, hook_event_name: 'Stop', reason: 'end_turn', stopHookActive: false }, home)).hookSpecificOutput
    expect(stop).toMatchObject({ hookEventName: 'Stop', additionalContext: expect.stringContaining('observation_id: o-') })
    expect(hook({ ...base, hook_event_name: 'Stop', reason: 'end_turn' }, home)).toBe('')
  })

  it('does nothing without a compaction request, or with LightShadow off', () => {
    const home = temp(), base = session(home)
    expect(hook({ ...base, transcript_path: join(temp(), 'updates.jsonl'), hook_event_name: 'PostCompact' }, home)).toBe('')
    const off = spawnSync(process.execPath, ['--conditions=source', main, 'hook', 'grok'], { encoding: 'utf8',
      input: JSON.stringify({ ...base, hook_event_name: 'PostCompact' }), env: { ...process.env, TOKENWISE_HOME: home, TOKENWISE_COMPACTION: 'off' } })
    expect(off.stdout).toBe('')
    expect(hook({ ...base, hook_event_name: 'Stop', reason: 'end_turn' }, home)).toBe('')
  })
})

// updates.jsonl as Grok 1.0.70 records it (segments mode writes no compaction_requests/).
const update = (u: object) => JSON.stringify({ timestamp: 't', method: 'session/update', params: { sessionId: 'gk-2', update: u } })
const toolPair = (id: string, input: object, text: string) => [
  update({ sessionUpdate: 'tool_call', toolCallId: id, title: 'run_terminal_command', rawInput: input, _meta: { 'x.ai/tool': { name: 'run_terminal_command' } } }),
  update({ sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed', content: [{ type: 'content', content: { type: 'text', text } }] }),
]
const checkpoint = (id: string) => update({ sessionUpdate: 'compaction_checkpoint', checkpoint_id: id, checkpoint_file: `compaction_checkpoints/${id}.json` })

describe('Grok span from updates.jsonl', () => {
  it('takes everything after the compaction before the latest, joining message chunks', () => {
    const lines = [update({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Fix ' } }), update({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'it' } }),
      ...toolPair('c1', { command: 'cat old.log' }, rows('old')), checkpoint('k1'),
      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Reading.' } }),
      ...toolPair('c2', { target_file: '/w/new.log' }, rows('new')), checkpoint('k2')]
    expect(grokSpanFromUpdates(lines)).toEqual([
      { role: 'assistant', text: 'Reading.' },
      { role: 'tool', text: rows('new'), toolName: 'run_terminal_command', callId: 'c2', call: '/w/new.log' },
    ])
    // Before Grok records the latest compaction, the span reaches back to the start: nothing is missed.
    expect(grokSpanFromUpdates(lines.slice(0, -1)).filter(m => m.role === 'tool')).toHaveLength(2)
  })

  it('PostCompact catalogs a segments-mode compaction from updates.jsonl', () => {
    const home = temp(), dir = join(temp(), 'gk-2')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'updates.jsonl'), [...toolPair('c1', { command: 'cat old.log' }, rows('old')), checkpoint('k1')].join('\n') + '\n')
    const base = { session_id: 'gk-2', transcript_path: join(dir, 'updates.jsonl'), cwd: home }
    hook({ ...base, hook_event_name: 'PostCompact' }, home)
    const next = JSON.parse(hook({ ...base, hook_event_name: 'PostToolUse', tool_name: 'read_file' }, home)).hookSpecificOutput
    expect(next.additionalContext).toContain('call: "cat old.log"')
  })
})
