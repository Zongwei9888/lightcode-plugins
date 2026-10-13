import { describe, expect, it } from 'vitest'
import { bashShellResult } from '../src/bash.ts'
import { bashResult } from './render.ts'

const parse = (options: Parameters<typeof bashResult>[0], command = 'pytest') => {
  const result = bashResult(options)
  return { shell: bashShellResult(command, result.value, result.content), rendered: result.content[0]!.text }
}

describe('DSH bash results', () => {
  it('locates stdout at the start and keeps the exit marker outside it', () => {
    const { shell, rendered } = parse({ stdout: 'a\nb\n', exitCode: 2 })
    expect(rendered).toBe('a\nb\n[exit code: 2]')
    expect(shell).toEqual({ command: 'pytest', rendered, exitCode: 2, truncated: false, stdout: { start: 0, text: 'a\nb\n' } })
  })
  it('locates stderr after its header, with and without a trailing newline on stdout', () => {
    for (const stdout of ['out\n', 'out', '']) {
      const { shell, rendered } = parse({ stdout, stderr: 'warn\n' })
      expect(rendered.slice(shell!.stderr!.start, shell!.stderr!.start + 5)).toBe('warn\n')
      expect(rendered.slice(0, shell!.stdout.text.length)).toBe(stdout)
    }
  })
  it('reports interrupted runs: timeout, signal, no exit code, sandbox denial', () => {
    for (const options of [{ timedOut: true, exitCode: null }, { signal: 'SIGKILL', exitCode: null }, { exitCode: null }, { denied: true, exitCode: 1 }]) {
      expect(parse({ stdout: 'x\n', ...options }).shell).toMatchObject({ interrupted: true })
    }
  })
  it('reports output DSH already cut', () => {
    expect(parse({ stdout: 'tail\n', stdoutTruncated: true }).shell).toMatchObject({ truncated: true })
    expect(parse({ stdout: 'x\n', stderr: 'tail\n', stderrTruncated: true }).shell).toMatchObject({ truncated: true })
  })
  it('marks a rendering it cannot explain as unsupported instead of guessing', () => {
    const result = bashResult({ stdout: 'a\n' })
    expect(bashShellResult('ls', result.value, [{ type: 'text', text: 'rewritten by someone else' }])!.stdout.start).toBe(-1)
    const withErr = bashResult({ stdout: 'a\n', stderr: 'b\n' })
    expect(bashShellResult('ls', withErr.value, [{ type: 'text', text: 'a\nb\n' }])!.stdout.start).toBe(-1)
  })
  it('ignores what is not a finished foreground bash call', () => {
    const result = bashResult({ stdout: 'a\n' })
    expect(bashShellResult(undefined, result.value, result.content)).toBeUndefined()
    expect(bashShellResult('ls', { kind: 'background', jobId: 'j1', cwd: '/' }, result.content)).toBeUndefined()
    expect(bashShellResult('ls', { kind: 'promoted', jobId: 'j1', cwd: '/', timeoutMs: 1, output: '' }, result.content)).toBeUndefined()
    expect(bashShellResult('ls', result.value, [])).toBeUndefined()
    expect(bashShellResult('ls', result.value, [result.content[0]!, result.content[0]!])).toBeUndefined()
    expect(bashShellResult('ls', result.value, [{ type: 'image', data: '' }])).toBeUndefined()
    expect(bashShellResult('ls', { ...result.value, stdout: { text: 1 } }, result.content)).toBeUndefined()
  })
})
