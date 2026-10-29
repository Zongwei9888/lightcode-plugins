import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileArtifactStore } from '@lightcode-ai/store'
import { claudeHook, codebuddyHook, eventHost, grokHook, hermesHook } from '../src/hook.ts'

const dirs: string[] = []
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'lightcode-hooks-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** Three source files whose `grep -rn value src` output LightCode shortens. */
function grepCase() {
  const cwd = temp()
  mkdirSync(join(cwd, 'src'))
  for (let f = 0; f < 3; f++) writeFileSync(join(cwd, 'src', `f${f}.ts`), Array.from({ length: 80 }, (_, i) => `export const value${i} = ${i} // value line`).join('\n') + '\n')
  const output = spawnSync('/bin/sh', ['-c', 'grep -rn value src'], { cwd, encoding: 'utf8' }).stdout
  return { cwd, output, home: temp() }
}

/** An environment with `lc` on PATH (a stub: wrapping never runs it). */
function withLc(home: string) {
  const bin = temp()
  writeFileSync(join(bin, 'lc'), '#!/bin/sh\n')
  chmodSync(join(bin, 'lc'), 0o755)
  return { LIGHTCODE_HOME: home, PATH: bin }
}

/** `pytest -v` with 150 passing tests and one failure, as the e2e fixture project prints it. */
const failingPytest = [
  '============================= test session starts ==============================',
  'platform darwin -- Python 3.12.4, pytest-8.3.2, pluggy-1.5.0 -- /usr/bin/python3', 'cachedir: .pytest_cache', 'rootdir: /w',
  'collecting ... collected 151 items', '',
  ...Array.from({ length: 150 }, (_, i) => `tests/test_versions.py::test_parse_${i} PASSED${' '.repeat(30)}[${String(Math.floor(i * 100 / 151)).padStart(3)}%]`),
  `tests/test_versions.py::test_version_ordering FAILED${' '.repeat(22)}[100%]`, '',
  '=================================== FAILURES ===================================',
  '____________________________ test_version_ordering _____________________________', '',
  '    def test_version_ordering():', ">       assert '1.10.0' > '1.9.0'", "E       AssertionError: assert '1.10.0' > '1.9.0'", '',
  'tests/test_versions.py:12: AssertionError',
  '=========================== short test summary info ============================',
  "FAILED tests/test_versions.py::test_version_ordering - AssertionError: assert '1.10.0' > '1.9.0'",
  '========================= 1 failed, 150 passed in 0.12s =========================', '',
].join('\n')

const records = (home: string, host: string) => readdirSync(join(home, 'journal', host))
  .flatMap(file => readFileSync(join(home, 'journal', host, file), 'utf8').trim().split('\n').map(line => JSON.parse(line)))

// Event shapes as Claude Code 2.1.310, CodeBuddy 2.175.0 and Grok 1.0.70 sent them (captured from real sessions).
const claudeEvent = (event: string, command: string, extra: Record<string, unknown> = {}) => ({
  session_id: 'cc-session', cwd: '/w', prompt_id: 'p1', permission_mode: 'default', hook_event_name: event, tool_name: 'Bash',
  tool_input: { command, description: 'Search' }, tool_use_id: 'toolu_01', ...extra,
})

describe('Claude Code hook', () => {
  it('replaces a successful call\'s output with its projection and keeps the original', () => {
    const { cwd, output, home } = grepCase()
    const response = { stdout: output.trimEnd(), stderr: '', interrupted: false, isImage: false, noOutputExpected: false }
    const reply = JSON.parse(claudeHook(claudeEvent('PostToolUse', 'grep -rn value src', { cwd, tool_response: response }), { LIGHTCODE_HOME: home })!)
    const replaced = reply.hookSpecificOutput.updatedToolOutput
    expect(reply.hookSpecificOutput.hookEventName).toBe('PostToolUse')
    // The replacement keeps Bash's own result shape, which Claude Code requires.
    expect(Object.keys(replaced).sort()).toEqual(Object.keys(response).sort())
    expect(replaced.stdout.length).toBeLessThan(response.stdout.length)
    expect(replaced.stdout).toContain('omitted')
    const [record] = records(home, 'claude')
    expect(record).toMatchObject({ host: 'claude', sessionId: 'cc-session', callId: 'toolu_01', tool: 'Bash', delivery: 'result-hook', streams: 'separate', outcome: 'projected' })
    expect(new FileArtifactStore(home).read(record.raw.sha256)).toBe(response.stdout)
  })

  it('wraps commands in bypassPermissions mode only, and then leaves their output alone', () => {
    const { home } = grepCase()
    const env = withLc(home)
    expect(claudeHook(claudeEvent('PreToolUse', 'grep -rn value src'), env)).toBeUndefined()
    const wrapped = JSON.parse(claudeHook(claudeEvent('PreToolUse', 'grep -rn value src', { permission_mode: 'bypassPermissions' }), env)!)
    // No permission decision; the rest of the input stays as the model wrote it.
    expect(wrapped).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse',
      updatedInput: { command: "lc run --host claude --session cc-session --call toolu_01 -c 'grep -rn value src'", description: 'Search' } } })
    expect(claudeHook(claudeEvent('PreToolUse', 'grep -rn value src', { permission_mode: 'bypassPermissions', tool_input: { command: 'grep -rn value src', run_in_background: true } }), env)).toBeUndefined()
    const after = claudeEvent('PostToolUse', wrapped.hookSpecificOutput.updatedInput.command, { tool_response: { stdout: 'x', stderr: '', interrupted: false, isImage: false } })
    expect(claudeHook(after, env)).toBeUndefined()
  })

  it('leaves other tools, unrecognized output and images alone', () => {
    const { cwd, output, home } = grepCase()
    const env = { LIGHTCODE_HOME: home }
    const response = { stdout: output, stderr: '', interrupted: false, isImage: false }
    expect(claudeHook(claudeEvent('PostToolUse', 'echo hi', { cwd, tool_response: { ...response, stdout: 'hi' } }), env)).toBeUndefined()
    expect(claudeHook({ ...claudeEvent('PostToolUse', 'grep -rn value src', { cwd, tool_response: response }), tool_name: 'Read' }, env)).toBeUndefined()
    expect(claudeHook(claudeEvent('PostToolUse', 'grep -rn value src', { cwd, tool_response: { ...response, isImage: true } }), env)).toBeUndefined()
    expect(claudeHook(claudeEvent('PostToolUseFailure', 'grep -rn value src', { cwd, error: 'Exit code 1' }), env)).toBeUndefined()
    expect(claudeHook(claudeEvent('PostToolUse', 'grep -rn value src', { cwd, tool_response: response }), { ...env, LIGHTCODE_DISABLE: '1' })).toBeUndefined()
  })

  it('leaves events from Grok and CodeBuddy, which also run Claude Code hooks, to their own hook', () => {
    const { cwd, output, home } = grepCase()
    const response = { stdout: output, stderr: '', interrupted: false, isImage: false }
    const event = claudeEvent('PostToolUse', 'grep -rn value src', { cwd, tool_response: response })
    expect(eventHost({ ...event, hookEventName: 'post_tool_use' }, {})).toBe('grok')
    expect(eventHost(event, { GROK_HOOK_EVENT: 'post_tool_use' })).toBe('grok')
    expect(eventHost({ ...event, generation_id: 'g1' }, {})).toBe('codebuddy')
    expect(eventHost(event, {})).toBeUndefined()
    expect(claudeHook(event, { LIGHTCODE_HOME: home, GROK_HOOK_EVENT: 'post_tool_use' })).toBeUndefined()
    expect(claudeHook({ ...event, generation_id: 'g1' }, { LIGHTCODE_HOME: home })).toBeUndefined()
  })
})

describe('CodeBuddy hook', () => {
  const event = (command: string, extra: Record<string, unknown> = {}) => ({
    session_id: 'cb-session', cwd: '/w', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command, description: 'Search' },
    call_id: 'call_00_x', tool_use_id: 'call_00_x', agent_type: 'cli', permission_mode: 'default', client: 'CLI', version: '2.175.0', generation_id: 'g1', ...extra,
  })

  it('wraps recognizable commands without a permission decision, and normalizes them', () => {
    const { home } = grepCase()
    const reply = JSON.parse(codebuddyHook(event('rg value src'), withLc(home))!)
    expect(reply).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse',
      updatedInput: { command: "lc run --host codebuddy --session cb-session --call call_00_x -c 'rg -n -H value src'", description: 'Search' } } })
    expect(reply.hookSpecificOutput).not.toHaveProperty('permissionDecision')
    expect(records(home, 'codebuddy')).toMatchObject([{ type: 'economy/command-rewrite', original: 'rg value src', tool: 'Bash' }])
  })

  it('leaves other commands, background commands, other events and wrapped commands alone', () => {
    const env = withLc(temp())
    expect(codebuddyHook(event('echo hi'), env)).toBeUndefined()
    expect(codebuddyHook(event('pytest', { tool_input: { command: 'pytest', run_in_background: true } }), env)).toBeUndefined()
    expect(codebuddyHook(event('pytest', { hook_event_name: 'PostToolUse' }), env)).toBeUndefined()
    expect(codebuddyHook(event("lc run -c 'pytest'"), env)).toBeUndefined()
  })
})

describe('Grok hook', () => {
  const event = (command: string, output: string, exitCode: number, extra: Record<string, unknown> = {}) => {
    const toolResult = { type: 'Bash', output: [...Buffer.from(output)], output_for_prompt: `exit: ${exitCode}\n${output}`, exit_code: exitCode,
      command, truncated: false, signal: null, timed_out: false, description: 'Search', current_dir: '/w', output_file: '/s/terminal/c.log', total_bytes: Buffer.byteLength(output) }
    return { hookEventName: 'post_tool_use', sessionId: 'gk-session', cwd: '/w', toolName: 'run_terminal_command', toolUseId: 'call-1-0', toolInput: { command },
      toolResult, isBackgrounded: false, hook_event_name: 'PostToolUse', session_id: 'gk-session', tool_name: 'run_terminal_command',
      tool_input: { command }, tool_response: toolResult, tool_use_id: 'call-1-0', ...extra }
  }

  it('replaces the model\'s copy of a result, failed commands included', () => {
    const { cwd, output, home } = grepCase()
    const env = { LIGHTCODE_HOME: home }
    const grep = JSON.parse(grokHook(event('grep -rn value src', output, 0, { cwd }), env)!).hookSpecificOutput.updatedToolOutput as string
    expect(grep.startsWith('exit: 0\n')).toBe(true)
    expect(grep.length).toBeLessThan(output.length)
    expect(grep).toContain('omitted')
    const tests = JSON.parse(grokHook(event('python3 -m pytest -v', failingPytest, 1, { cwd }), env)!).hookSpecificOutput.updatedToolOutput as string
    expect(tests.startsWith('exit: 1\n')).toBe(true)
    expect(tests.length).toBeLessThan(failingPytest.length / 4)
    expect(tests).toContain("E       AssertionError: assert '1.10.0' > '1.9.0'")
    expect(tests).toContain('tests/test_versions.py::test_version_ordering')
    const journaled = records(home, 'grok')
    expect(journaled).toMatchObject([{ exitCode: 0, outcome: 'projected', streams: 'merged', delivery: 'result-hook', tool: 'run_terminal_command' },
      { exitCode: 1, outcome: 'projected', filter: 'pytest' }])
    expect(new FileArtifactStore(home).read(journaled[0].raw.sha256)).toBe(output)
  })

  it('leaves cut, oversized, unexpected and undecodable results alone', () => {
    const { cwd, output, home } = grepCase()
    const env = { LIGHTCODE_HOME: home }
    const base = event('grep -rn value src', output, 0, { cwd })
    const result = base.toolResult
    // Cut by Grok: recorded as passed, never projected.
    expect(grokHook({ ...base, toolResult: { ...result, truncated: true } }, env)).toBeUndefined()
    // Over 128 KiB Grok sends the model-facing text as a string.
    expect(grokHook({ ...base, toolResult: `exit: 0\n${output}` }, env)).toBeUndefined()
    expect(grokHook({ ...base, toolResult: { ...result, output_for_prompt: `exit: 0\n[shortened]` } }, env)).toBeUndefined()
    expect(grokHook({ ...base, toolResult: { ...result, output: [0xff, 0xfe], output_for_prompt: 'exit: 0\n�' } }, env)).toBeUndefined()
    expect(grokHook({ ...base, isBackgrounded: true }, env)).toBeUndefined()
    expect(grokHook({ ...base, tool_name: 'read_file' }, env)).toBeUndefined()
    expect(records(home, 'grok')).toMatchObject([{ outcome: 'passed', reason: 'already-truncated' }])
  })
})

describe('Hermes hook', () => {
  // What the Hermes plugin sends for transform_terminal_output (Hermes 0.22.5).
  const event = (command: string, output: string, returncode: unknown, extra: Record<string, unknown> = {}) => ({
    hook_event_name: 'transform_terminal_output', command, output, returncode, task_id: 'hm-task', tool_call_id: 'call_1', env_type: 'local', ...extra })

  it('answers with the projection of a recognized output, failed commands included', () => {
    const { cwd, output, home } = grepCase()
    const env = { LIGHTCODE_HOME: home }
    const grep = JSON.parse(hermesHook(event('grep -rn value src', output, 0, { cwd }), env)!).output as string
    expect(grep.length).toBeLessThan(output.length)
    expect(grep).toContain('omitted')
    const tests = JSON.parse(hermesHook(event('python3 -m pytest -v', failingPytest, 1, { cwd }), env)!).output as string
    expect(tests.length).toBeLessThan(failingPytest.length / 4)
    expect(tests).toContain("E       AssertionError: assert '1.10.0' > '1.9.0'")
    expect(records(home, 'hermes')).toMatchObject([
      { sessionId: 'hm-task', callId: 'call_1', tool: 'terminal', delivery: 'result-hook', streams: 'merged', exitCode: 0, outcome: 'projected' },
      { exitCode: 1, outcome: 'projected', filter: 'pytest' }])
  })

  it('leaves cut, stopped, background and unrecognized output alone', () => {
    const { cwd, output, home } = grepCase()
    const env = { LIGHTCODE_HOME: home }
    const cut = `${output.slice(0, 2000)}\n\n... [OUTPUT TRUNCATED - 9,000 chars omitted out of 12,000 total] ...\n\n${output.slice(-2000)}`
    expect(hermesHook(event('grep -rn value src', cut, 0, { cwd }), env)).toBeUndefined()
    expect(hermesHook(event('python3 -m pytest -v', `${failingPytest}\n[Command timed out after 180s]`, 124, { cwd }), env)).toBeUndefined()
    expect(hermesHook(event('python3 -m pytest -v', `${failingPytest}\n[Command interrupted]`, 130, { cwd }), env)).toBeUndefined()
    expect(hermesHook(event('python3 -m pytest -v', failingPytest, null, { cwd }), env)).toBeUndefined()
    expect(hermesHook(event('echo hi', 'hi\n'.repeat(200), 0, { cwd }), env)).toBeUndefined()
    expect(hermesHook({ ...event('grep -rn value src', output, 0, { cwd }), hook_event_name: 'transform_tool_result' }, env)).toBeUndefined()
    expect(records(home, 'hermes').map(record => record.reason)).toEqual(['already-truncated', 'interrupted-result', 'interrupted-result'])
  })
})
