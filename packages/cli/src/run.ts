import { spawn } from 'node:child_process'
import { basename } from 'node:path'
import { constants } from 'node:os'
import { EconomyEngine } from '@lightcode/mechanisms'
import { RuleStore, collectDaily } from '@lightcode/store'
import type { ShellResult } from '@lightcode/core'
import { cliContext, shellQuote } from './context.ts'

export interface RunOptions {
  readonly host: string
  readonly sessionId: string | null
  readonly callId: string | null
  readonly tool: string
  /** Shell script run with `$SHELL -c` (or /bin/sh). */
  readonly script?: string
  /** Program and arguments run directly, without a shell. */
  readonly argv?: readonly string[]
}

/** Per stream; beyond it LightCode stops buffering and passes the rest through unchanged. */
const CAPTURE_LIMIT = 32 * 1024 * 1024
const FORWARDED = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'] as const
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])

/** The command text filters see: the script itself, never LightCode's wrapper. */
export function commandText(options: Pick<RunOptions, 'script' | 'argv'>): string {
  if (options.script !== undefined) return options.script
  const argv = options.argv ?? []
  if (argv.length === 3 && SHELLS.has(basename(argv[0]!)) && (argv[1] === '-c' || argv[1] === '-lc')) return argv[2]!
  return argv.map(shellQuote).join(' ')
}

function shellProgram(env: NodeJS.ProcessEnv): string {
  const shell = env.SHELL
  return shell && shell.startsWith('/') && SHELLS.has(basename(shell)) ? shell : '/bin/sh'
}

const utf8 = new TextDecoder('utf-8', { fatal: true })
function decode(chunks: readonly Buffer[]): string | undefined {
  try { return utf8.decode(Buffer.concat(chunks)) } catch { return undefined }
}

/**
 * Run a command, then print a projection of its output when a filter applies.
 * Exit status and signals are passed through. Output is printed when the
 * command finishes; unfiltered output keeps the original stdout/stderr order.
 */
export function run(options: RunOptions): Promise<never> {
  const env = process.env
  const command = commandText(options)
  const program = options.script !== undefined ? shellProgram(env) : options.argv?.[0]
  const args = options.script !== undefined ? ['-c', options.script] : (options.argv ?? []).slice(1)
  if (!program) {
    process.stderr.write('lc run: missing command (use -c <script> or -- <program> [args...])\n')
    process.exit(2)
  }
  const child = spawn(program, args, { stdio: ['inherit', 'pipe', 'pipe'], env })
  const order: { fd: 1 | 2; chunk: Buffer }[] = []
  const sizes = { 1: 0, 2: 0 }
  let passthrough = false
  const forward = (signal: NodeJS.Signals) => () => { try { child.kill(signal) } catch { /* Already gone. */ } }
  const handlers = FORWARDED.map(signal => [signal, forward(signal)] as const)
  for (const [signal, handler] of handlers) process.on(signal, handler)
  const write = (fd: 1 | 2, data: Buffer | string) => (fd === 1 ? process.stdout : process.stderr).write(data)
  const collect = (fd: 1 | 2) => (chunk: Buffer) => {
    if (passthrough) { write(fd, chunk); return }
    order.push({ fd, chunk })
    sizes[fd] += chunk.length
    if (sizes[fd] > CAPTURE_LIMIT) {
      // Too large to hold: stop filtering and stream everything from here on.
      passthrough = true
      for (const item of order.splice(0)) write(item.fd, item.chunk)
    }
  }
  child.stdout!.on('data', collect(1))
  child.stderr!.on('data', collect(2))

  return new Promise<never>(() => {
    child.on('error', error => {
      for (const [signal, handler] of handlers) process.off(signal, handler)
      const code = (error as NodeJS.ErrnoException).code
      process.stderr.write(`lc run: ${program}: ${code === 'ENOENT' ? 'command not found' : error.message}\n`)
      process.exit(code === 'ENOENT' ? 127 : 126)
    })
    child.on('close', (code, signal) => {
      for (const [name, handler] of handlers) process.off(name, handler)
      const finish = () => {
        if (signal) {
          process.kill(process.pid, signal)
          // Signals without a default terminating action fall through to the shell convention.
          process.exit(128 + (constants.signals[signal] ?? 1))
        }
        process.exit(code ?? 1)
      }
      if (passthrough) return void flushThen(finish)
      try {
        const replaced = project(options, command, code, signal, order)
        if (replaced) {
          if (replaced.first === 2) { if (replaced.stderr) write(2, replaced.stderr); if (replaced.stdout) write(1, replaced.stdout) }
          else { if (replaced.stdout) write(1, replaced.stdout); if (replaced.stderr) write(2, replaced.stderr) }
        } else for (const item of order) write(item.fd, item.chunk)
      } catch {
        for (const item of order) write(item.fd, item.chunk)
      }
      flushThen(finish)
    })
  })
}

function flushThen(next: () => void): void {
  let pending = 2
  const done = () => { if (--pending === 0) next() }
  process.stdout.write('', done)
  process.stderr.write('', done)
}

function project(options: RunOptions, command: string, code: number | null, signal: NodeJS.Signals | null,
  order: readonly { fd: 1 | 2; chunk: Buffer }[]): { stdout?: string; stderr?: string; first: 1 | 2 } | undefined {
  const context = cliContext()
  const { config } = context.loaded
  if (config.economy.mode === 'off') return undefined
  // Originals must be savable before anything is filtered (sandboxed hosts may only allow TMPDIR).
  const store = context.writable()
  if (!store) return undefined
  const engine = new EconomyEngine({ host: options.host, journal: store.journal, artifacts: store.artifacts,
    config: config.economy, mode: config.economy.mode, delivery: 'command-wrapper', streams: 'separate',
    learned: () => new RuleStore(context.dataDir).load() })
  const stdout = decode(order.filter(item => item.fd === 1).map(item => item.chunk))
  const stderr = decode(order.filter(item => item.fd === 2).map(item => item.chunk))
  // Binary output is never filtered, and neither is the other stream of the same command.
  if (stdout === undefined || stderr === undefined) return undefined
  const exitCode = code ?? -1
  const interrupted = signal !== null || code === null
  const request = (result: ShellResult) => ({ sessionId: options.sessionId, callId: options.callId, tool: options.tool, result })
  let projectedOut: string | undefined, projectedErr: string | undefined
  if (stdout !== '') {
    projectedOut = engine.process(request({ command, exitCode, interrupted, rendered: stdout, stdout: { start: 0, text: stdout } })).text
  }
  if (stderr !== '') {
    projectedErr = engine.process(request({ command, exitCode, interrupted, rendered: stderr,
      stdout: { start: 0, text: '' }, stderr: { start: 0, text: stderr } })).text
  }
  try { collectDaily(store.dataDir, days => store.artifacts.prune(days), config.artifacts.retentionDays) } catch { /* Housekeeping only. */ }
  if (projectedOut === undefined && projectedErr === undefined) return undefined
  return { stdout: projectedOut ?? stdout, stderr: projectedErr ?? stderr, first: order[0]?.fd ?? 1 }
}
