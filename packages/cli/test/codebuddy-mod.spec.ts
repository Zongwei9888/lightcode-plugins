import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RECALL_INPUT_SCHEMA, RECALL_TOOL_DESCRIPTION, SHADOW_SUMMARY_INSTRUCTION } from '@lightcode-ai/mechanisms'

// Each test starts real `lc` processes; under a full parallel run they take longer than the default 5 s.
vi.setConfig({ testTimeout: 30_000 })

const mod = fileURLToPath(new URL('../../../adapters/codebuddy/hooks/lightshadow.js', import.meta.url))
const main = fileURLToPath(new URL('../src/main.ts', import.meta.url))
const dirs: string[] = []
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'lightcode-cb-mod-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

type Handler = ($: unknown, e: Record<string, unknown>, next: (e: Record<string, unknown>) => Promise<unknown>) => Promise<unknown>

/** The mod's handlers and a `$` whose process.run is the real `lc` (the mod runs `/bin/sh -c 'exec lc "$@"' lc …`). */
async function load(home: string, lcWorks = true) {
  const { register, spanOf } = await import(pathToFileURL(mod).href) as { register: (on: (name: string, fn: Handler) => void) => void; spanOf: (m: unknown) => unknown[] }
  const handlers = new Map<string, Handler>()
  register((name, fn) => { handlers.set(name, fn) })
  const registered: unknown[] = []
  const $ = {
    session: { id: async () => 'cb-session-1' },
    tool: { register: async (spec: unknown) => { registered.push(spec) } },
    process: { run: async (argv: string[], init: { stdin?: string } = {}) => {
      if (!lcWorks) return { exitCode: 127, stdout: '', stderr: 'lc: not found' }
      const done = spawnSync(process.execPath, ['--conditions=source', main, ...argv.slice(4)], { input: init.stdin, encoding: 'utf8', env: { ...process.env, LIGHTCODE_HOME: home } })
      return { exitCode: done.status ?? 1, stdout: done.stdout, stderr: done.stderr }
    } },
  }
  const fire = async (name: string, e: Record<string, unknown>) => {
    let passed: Record<string, unknown> | undefined
    const answer = await handlers.get(name)!($, e, async next => { passed = next; return { ok: true } })
    return { answer, passed }
  }
  return { fire, registered, spanOf }
}

const rows = (tag: string) => Array.from({ length: 400 }, (_, i) => `${tag} ${i}: ${(i * 7919) % 10007}`).join('\n')
// session.compact's messages as CodeBuddy 2.175 hands them over.
const transcript = [
  { role: 'user', text: 'Check the export file.', toolUses: [] },
  { role: 'assistant', text: 'Reading it.', toolUses: [{ tool_use_id: 't1', tool: 'Bash', input: { command: 'cat export.csv' }, text: rows('row') }] },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't1', text: rows('row'), isError: false }] },
]
const summaryRow = (inner: string) => ({ role: 'assistant', content: [{ type: 'text', text: `<conversation_history_summary>\n<summary>\n${inner}\n</summary>\n</conversation_history_summary>` }] })

describe('CodeBuddy LightShadow mod', () => {
  it('reads the span, rewrites the stored summary into a checkpoint, and recalls a listed result', async () => {
    const home = temp()
    const { fire, registered, spanOf } = await load(home)
    expect(spanOf(transcript)).toEqual([
      { role: 'user', text: 'Check the export file.' },
      { role: 'assistant', text: 'Reading it.\nBash {"command":"cat export.csv"}' },
      { role: 'tool', text: rows('row'), tool_name: 'Bash', call_id: 't1', call_input: { command: 'cat export.csv' } },
    ])
    await fire('session.start', {})
    expect(registered).toMatchObject([{ name: 'lightcode_recall', isDeferred: false }])
    const compact = await fire('session.compact', { trigger: 'manual', instructions: 'keep the totals', messages: transcript })
    expect(compact.passed!.instructions).toMatch(/^keep the totals\n\nAfter this compaction/u)
    // The compaction prompt also passes through session.append (door "prompt"): left alone.
    const prompt = await fire('session.append', { door: 'prompt', message: summaryRow('template') })
    expect(prompt.passed!.message).toEqual(summaryRow('template'))
    const stored = await fire('session.append', { door: 'response', uuid: 'u1', message: summaryRow('1. The export has 400 rows.') })
    const text = (stored.passed!.message as { content: { text: string }[] }).content[0]!.text
    expect(text).toMatch(/^<conversation_history_summary>\n<summary>\n1\. The export has 400 rows\./u)
    expect(text).toContain('"Check the export file."')
    expect(text).toContain('call: "cat export.csv"')
    expect(text).toMatch(/<\/lightcode-observation-catalog>\n<\/summary>\n<\/conversation_history_summary>$/u)
    const id = /observation_id: (o-[a-f0-9]{12})/u.exec(text)![1]!
    expect((await fire('tool.check', { tool: 'mcp__lightcode__lightcode_recall' })).answer).toEqual({ decision: 'allow' })
    const recalled = await fire('tool.call', { tool: 'lightcode_recall', tool_use_id: 'x', observation_id: id, query: 'row 222:' })
    expect((recalled.answer as { result: string }).result).toContain(`row 222: ${(222 * 7919) % 10007}`)
    // Only once: a later response that looks like a summary is not rewritten.
    const later = await fire('session.append', { door: 'response', message: summaryRow('again') })
    expect(later.passed!.message).toEqual(summaryRow('again'))
  })

  it('passes everything on unchanged when lc is missing, and other tools through', async () => {
    const { fire } = await load(temp(), false)
    await fire('session.compact', { trigger: 'auto', messages: transcript })
    const stored = await fire('session.append', { door: 'response', message: summaryRow('Summary.') })
    expect(stored.passed!.message).toEqual(summaryRow('Summary.'))
    expect((await fire('tool.check', { tool: 'Bash' })).passed).toEqual({ tool: 'Bash' })
    expect((await fire('tool.call', { tool: 'Bash', command: 'ls' })).passed).toEqual({ tool: 'Bash', command: 'ls' })
  })

  it('carries the same instruction and recall tool as the TypeScript core', async () => {
    const { fire, registered } = await load(temp())
    await fire('session.start', {})
    expect(registered).toEqual([{ name: 'lightcode_recall', description: RECALL_TOOL_DESCRIPTION, inputSchema: RECALL_INPUT_SCHEMA, isDeferred: false }])
    const compact = await fire('session.compact', { trigger: 'auto', messages: transcript })
    expect(compact.passed!.instructions).toBe(SHADOW_SUMMARY_INSTRUCTION)
  })
})
