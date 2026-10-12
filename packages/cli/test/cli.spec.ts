import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { codexPreToolUse } from '../src/hook.ts'
import { commandText } from '../src/run.ts'
import { shellQuote } from '../src/context.ts'

const main = fileURLToPath(new URL('../src/main.ts', import.meta.url))
const dirs: string[] = []
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'lightcode-cli-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function lc(args: string[], options: { cwd?: string; home?: string; input?: string; env?: NodeJS.ProcessEnv } = {}) {
  const result = spawnSync(process.execPath, ['--conditions=source', main, ...args], {
    cwd: options.cwd, input: options.input === undefined ? undefined : Buffer.from(options.input), encoding: 'buffer',
    env: { ...process.env, SHELL: '/bin/sh', LIGHTCODE_HOME: options.home ?? temp(), ...options.env },
  })
  return { ...result, out: result.stdout.toString('utf8'), err: result.stderr.toString('utf8') }
}

function project() {
  const dir = temp()
  mkdirSync(join(dir, 'src'))
  for (let f = 0; f < 3; f++) {
    writeFileSync(join(dir, 'src', `f${f}.ts`), Array.from({ length: 80 }, (_, i) => `export const value${i} = ${i} // value line`).join('\n') + '\n')
  }
  return dir
}

describe('lc run', () => {
  it('passes exit codes and unfiltered output through unchanged', () => {
    const result = lc(['run', '-c', 'printf "a\\nb\\n"; exit 3'])
    expect(result.status).toBe(3)
    expect(result.out).toBe('a\nb\n')
    expect(lc(['run', '--', 'definitely-not-a-command-xyz']).status).toBe(127)
  })
  it('keeps binary output byte-for-byte', () => {
    const result = lc(['run', '-c', "printf '\\377\\376\\000x'"])
    expect([...result.stdout]).toEqual([0xff, 0xfe, 0x00, 0x78])
  })
  it('re-raises the signal that killed the command', () => {
    const result = lc(['run', '-c', 'kill -TERM $$'])
    expect(result.signal).toBe('SIGTERM')
  })
  it('filters recognized output, saves the original and reports it', () => {
    const cwd = project(), home = temp()
    const raw = spawnSync('/bin/sh', ['-c', 'grep -rn value src'], { cwd, encoding: 'utf8' }).stdout
    const result = lc(['run', '--host', 'test', '--session', 's1', '-c', 'grep -rn value src'], { cwd, home })
    expect(result.status).toBe(0)
    expect(result.out.length).toBeLessThan(raw.length)
    expect(result.out).toContain('omitted')
    const report = JSON.parse(lc(['report', '--host', 'test', '--json'], { home }).out)
    expect(report).toMatchObject({ projected: 1, byFilter: [{ filter: 'grep', count: 1 }] })
    const journal = spawnSync('/bin/sh', ['-c', 'cat journal/test/s1.jsonl'], { cwd: home, encoding: 'utf8' }).stdout
    const record = JSON.parse(journal.trim())
    expect(lc(['show', record.raw.sha256], { home }).out).toBe(raw)
  })
  it('passes everything through when disabled', () => {
    const cwd = project()
    const raw = spawnSync('/bin/sh', ['-c', 'grep -rn value src'], { cwd, encoding: 'utf8' }).stdout
    expect(lc(['run', '-c', 'grep -rn value src'], { cwd, env: { LIGHTCODE_DISABLE: '1' } }).out).toBe(raw)
  })
  it('rejects ambiguous invocations', () => {
    expect(lc(['run']).status).toBe(2)
    expect(lc(['run', '-c', 'true', '--', 'true']).status).toBe(2)
  })
})

describe('commandText and quoting', () => {
  it('filters on the script, not on the shell wrapper', () => {
    expect(commandText({ script: 'pytest -x' })).toBe('pytest -x')
    expect(commandText({ argv: ['bash', '-lc', 'git status'] })).toBe('git status')
    expect(commandText({ argv: ['git', 'diff', 'a b'] })).toBe("git diff 'a b'")
  })
  it('round-trips arbitrary text through the shell', () => {
    for (const value of ["it's", 'a "b" $HOME `x` \\n', 'line1\nline2', '中文 😀', '']) {
      expect(spawnSync('/bin/sh', ['-c', `printf %s ${shellQuote(value)}`], { encoding: 'utf8' }).stdout).toBe(value)
    }
  })
})

describe('Codex PreToolUse hook', () => {
  const input = (command: string) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', session_id: 'thread-1', tool_use_id: 'call_1', tool_input: { command } })
  it('wraps recognizable commands and normalizes them', () => {
    const output = JSON.parse(codexPreToolUse(input('rg value src'), { LIGHTCODE_HOME: temp() })!)
    expect(output).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow',
      updatedInput: { command: "lc run --host codex --session thread-1 --call call_1 -c 'rg -n -H value src'" } } })
  })
  it('leaves other commands, patches, wrapped commands and other events alone', () => {
    const env = { LIGHTCODE_HOME: temp() }
    expect(codexPreToolUse(input('echo hello'), env)).toBeUndefined()
    expect(codexPreToolUse(input("apply_patch <<'EOF'\n*** Begin Patch\nEOF"), env)).toBeUndefined()
    expect(codexPreToolUse(input("lc run -c 'pytest'"), env)).toBeUndefined()
    expect(codexPreToolUse({ ...input('pytest'), hook_event_name: 'PostToolUse' }, env)).toBeUndefined()
    expect(codexPreToolUse({ ...input('pytest'), tool_name: 'apply_patch' }, env)).toBeUndefined()
    expect(codexPreToolUse(input('pytest'), { ...env, LIGHTCODE_DISABLE: '1' })).toBeUndefined()
  })
  it('never fails a tool call through the CLI', () => {
    const result = lc(['hook', 'codex'], { input: 'not json' })
    expect(result.status).toBe(0)
    expect(result.out).toBe('')
  })
})

describe('lc doctor', () => {
  it('reports per-host negotiation', () => {
    const result = lc(['doctor', '--json'])
    const doctor = JSON.parse(result.out)
    expect(doctor.hosts.find((host: { host: string }) => host.host === 'codex').mechanisms[0]).toMatchObject({ mechanism: 'economy', mode: 'apply' })
    expect(doctor.config.problems).toEqual([])
  })
})
