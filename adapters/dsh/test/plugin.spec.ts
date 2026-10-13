import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Config, apply, inject, name } from '../src/index.ts'
import type { CommandRuntime, HostContext, PostToolDecision, ToolExecution, ToolExecutionResult } from '../src/host.ts'
import { bashResult, pytestOutput } from './render.ts'

let home: string
const saved = process.env.LIGHTCODE_HOME
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'lightcode-dsh-plugin-')); process.env.LIGHTCODE_HOME = home })
afterEach(() => {
  if (saved === undefined) delete process.env.LIGHTCODE_HOME
  else process.env.LIGHTCODE_HOME = saved
  rmSync(home, { recursive: true, force: true })
})

type Listener = (exec: ToolExecution, result: ToolExecutionResult, next: () => Promise<PostToolDecision>) => Promise<PostToolDecision>

function fakeContext() {
  const listeners: { listener: Listener }[] = []
  const commands: Parameters<CommandRuntime['register']>[0][] = []
  const disposers: (() => void)[] = []
  const warnings: string[] = []
  const ctx: HostContext = {
    on: (_event, listener) => { listeners.push({ listener }); return () => {} },
    inject: (deps, callback) => {
      expect(deps).toEqual(['commands'])
      callback({ ...ctx, commands: { register: definition => { commands.push(definition); return () => {} } } })
    },
    effect: execute => { disposers.push(execute()) },
    logger: { warn: message => warnings.push(message), info: () => {} },
  }
  return { ctx, listeners, commands, disposers, warnings }
}

const live = <T>(value: T) => ({ get: () => value })
const call: ToolExecution = { callId: 'c1', name: 'bash', arguments: { command: 'pytest -v' }, agent: { session: { id: 's1' } } }

describe('DSH plugin entry', () => {
  it('declares what cordis needs to load it', () => {
    expect(name).toBe('lightcode')
    expect(inject).toEqual(['tools'])
    // The Loader resolves `mode` to a live reference; `get()` reads the current value.
    expect(Config({}).mode.get()).toBe('apply')
    expect(Config({}).inlineLimitChars).toBe(48_000)
    expect(Config({ mode: 'observe' }).mode.get()).toBe('observe')
    expect(() => Config({ mode: 'fast' as 'off' })).toThrow()
  })
  it('joins the post-execute waterfall innermost and filters the bash result itself', async () => {
    const { ctx, listeners } = fakeContext()
    apply(ctx, { mode: live('apply'), inlineLimitChars: 48_000 })
    expect(listeners).toHaveLength(1)
    const result = bashResult({ stdout: pytestOutput(60) })
    const decision = await listeners[0]!.listener(call, result, async () => ({ kind: 'accept' }))
    expect((decision as { content: { text: string }[] }).content[0]!.text).toContain('60 passed')
  })
  it('never swallows a downstream failure', async () => {
    const { ctx, listeners } = fakeContext()
    apply(ctx, { mode: live('apply'), inlineLimitChars: 48_000 })
    await expect(listeners[0]!.listener(call, bashResult({ stdout: 'x' }), () => Promise.reject(new Error('downstream')))).rejects.toThrow('downstream')
  })
  it('registers /lightcode, which reports this session', async () => {
    const { ctx, listeners, commands } = fakeContext()
    apply(ctx, { mode: live('apply'), inlineLimitChars: 48_000 })
    expect(commands.map(command => command.name)).toEqual(['lightcode'])
    await listeners[0]!.listener(call, bashResult({ stdout: pytestOutput(60) }), async () => ({ kind: 'accept' }))
    const output = await commands[0]!.handler({ agent: { session: { id: 's1' } }, rawInput: '' })
    expect(output.kind).toBe('success')
    expect(output.text).toContain('(1 of 1 outputs filtered)')
  })
})
