import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CODEX_RECALL_TOOL, codexSpan } from '../src/codex-shadow.ts'

// Each test starts real `tokenwise` processes; under a full parallel run they take longer than the default 5 s.
vi.setConfig({ testTimeout: 30_000 })

const main = fileURLToPath(new URL('../src/main.ts', import.meta.url))
const dirs: string[] = []
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'tokenwise-codex-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** An `tokenwise` on PATH: the hook only rewrites to `tokenwise run` when one is there to run it. */
function lcOnPath() {
  const bin = temp()
  writeFileSync(join(bin, 'tokenwise'), '#!/bin/sh\n')
  chmodSync(join(bin, 'tokenwise'), 0o755)
  return `${bin}:${process.env.PATH ?? ''}`
}
const run = (args: string[], home: string, input?: string) =>
  spawnSync(process.execPath, ['--conditions=source', main, ...args], { input, encoding: 'utf8', env: { ...process.env, TOKENWISE_HOME: home, PATH: lcOnPath() } }).stdout

// Rollout lines as Codex 0.165 writes them.
const item = (payload: Record<string, unknown>) => ({ timestamp: 't', type: 'response_item', payload })
const message = (role: string, text: string) => item({ type: 'message', role, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }] })
const exec = (callId: string, input: string) => item({ type: 'custom_tool_call', call_id: callId, name: 'exec', input, status: 'completed' })
const nested = (command: string) => ({ timestamp: 't', type: 'event_msg', payload: { type: 'item_completed', item: { type: 'CommandExecution', id: 'exec-1', command: ['/bin/zsh', '-lc', command] } } })
const execOutput = (callId: string, text: string) => item({ type: 'custom_tool_call_output', call_id: callId,
  output: [{ type: 'input_text', text: 'Script completed\nWall time 0.1 seconds\nOutput:\n' }, { type: 'input_text', text }] })
const fn = (callId: string, args: object) => item({ type: 'function_call', call_id: callId, name: 'shell', arguments: JSON.stringify(args) })
const fnOutput = (callId: string, output: string) => item({ type: 'function_call_output', call_id: callId, output })
const compacted = { timestamp: 't', type: 'compacted', payload: { message: '', replacement_history: [] } }

const seq = (from: number) => Array.from({ length: 600 }, (_, i) => String(from + i)).join('\n')
const write = (path: string, lines: object[]) => writeFileSync(path, lines.map(line => JSON.stringify(line)).join('\n') + '\n')
const ids = (text: string) => [...text.matchAll(/observation_id: (o-[a-f0-9]{12})/gu)].map(match => match[1]!)

describe('Codex rollout span', () => {
  it('takes the items between the last two compactions, labels exec results by the commands they ran', () => {
    const lines = [message('user', 'old'), compacted, message('developer', 'catalog'), message('user', '<environment_context>cwd</environment_context>'),
      message('user', 'Count to 600'), exec('c1', 'text(await tools.exec_command({cmd:"seq 1 600"}))'), nested('seq 1 600'), execOutput('c1', seq(1)),
      fn('c2', { command: ['bash', '-lc', 'ls'], cmd: 'ls -la' }), fnOutput('c2', 'a\nb'), compacted, message('user', 'after')]
    const span = codexSpan(lines)
    expect(span.map(m => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'tool'])
    expect(span[2]).toMatchObject({ role: 'tool', toolName: 'exec', callId: 'c1', call: 'seq 1 600' })
    expect(span[2]!.text).toMatch(/^Script completed/u)
    expect(span[4]).toMatchObject({ toolName: 'shell', call: 'ls -la', text: 'a\nb' })
    expect(codexSpan([message('user', 'no compaction yet')])).toEqual([])
  })
})

describe('tokenwise hook codex: LightShadow', () => {
  it('returns a cumulative catalog after each compaction that names the code-mode call, and recall reads it', () => {
    const home = temp(), dir = temp(), rollout = join(dir, 'rollout.jsonl')
    const first = [message('user', 'Count'), exec('c1', 'x'), nested('seq 100000 100600'), execOutput('c1', seq(100000)), compacted]
    write(rollout, first)
    const input = { hook_event_name: 'SessionStart', source: 'compact', session_id: 'th1', transcript_path: rollout, cwd: dir }
    const one = JSON.parse(run(['hook', 'codex'], home, JSON.stringify(input))).hookSpecificOutput
    expect(one.hookEventName).toBe('SessionStart')
    expect(one.additionalContext).toContain(`await tools.${CODEX_RECALL_TOOL}(`)
    expect(one.additionalContext).toContain('call: "seq 100000 100600"')
    write(rollout, [...first, message('developer', one.additionalContext), exec('c2', 'y'), nested('seq 200000 200600'), execOutput('c2', seq(200000)), compacted])
    const two = JSON.parse(run(['hook', 'codex'], home, JSON.stringify(input))).hookSpecificOutput.additionalContext
    expect(ids(two)).toHaveLength(2)
    expect(run(['recall', ids(two)[0]!, '--query', '100321'], home)).toContain('100321')
  })

  it('still rewrites Bash commands and ignores other session starts', () => {
    const home = temp()
    expect(run(['hook', 'codex'], home, JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'x', transcript_path: '/nope' }))).toBe('')
    const wrapped = JSON.parse(run(['hook', 'codex'], home, JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', session_id: 's', tool_use_id: 'u',
      tool_input: { command: 'git status' } })))
    expect(wrapped.hookSpecificOutput.updatedInput.command).toMatch(/^tokenwise run /u)
  })
})
