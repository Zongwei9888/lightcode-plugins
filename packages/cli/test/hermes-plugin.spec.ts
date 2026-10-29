import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const adapter = fileURLToPath(new URL('../../../adapters/hermes/', import.meta.url))
const dirs: string[] = []
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'lightcode-hermes-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const python = ['python3', 'python'].find(name => spawnSync(name, ['-c', 'import sys; assert sys.version_info >= (3, 9)']).status === 0)

/** Run Python with the plugin importable, the way Hermes imports `~/.hermes/plugins/lightcode`. */
function plugin(code: string, env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(python!, ['-I', '-B', '-c', `import sys, json\nsys.path.insert(0, ${JSON.stringify(adapter)})\nimport lightcode as lc\n${code}`],
    { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', ...env } })
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

/** A stand-in `lc` that records what it was sent and answers like `lc hook hermes`. */
function stub(reply: string, status = 0) {
  const dir = temp()
  const script = join(dir, 'lc')
  writeFileSync(script, `#!/bin/sh\necho "$@" > "${dir}/argv"\ncat > "${dir}/stdin"\nprintf '%s' '${reply}'\nexit ${status}\n`)
  chmodSync(script, 0o755)
  return { script, sent: () => JSON.parse(readFileSync(join(dir, 'stdin'), 'utf8')), argv: () => readFileSync(join(dir, 'argv'), 'utf8').trim() }
}

const output = 'x'.repeat(300)

describe.skipIf(!python)('Hermes plugin', () => {
  it('registers both hooks, and hands the terminal output to lc hook hermes under its session', () => {
    const lc = stub('{"output": "projected"}')
    const result = plugin(`
hooks = []
class Ctx:
    def register_hook(self, name, fn): hooks.append(name)
lc.register(Ctx())
lc._remember_session(tool_name="terminal", session_id="sess-1", tool_call_id="call-1", args={})
print(json.dumps({"hooks": hooks, "out": lc._transform(command="pytest", output=${JSON.stringify(output)}, returncode=1, task_id="default", env_type="local", tool_call_id="call-1")}))`,
    { LIGHTCODE_LC: lc.script })
    expect(JSON.parse(result)).toEqual({ hooks: ['pre_tool_call', 'transform_terminal_output'], out: 'projected' })
    expect(lc.argv()).toBe('hook hermes')
    expect(lc.sent()).toMatchObject({ hook_event_name: 'transform_terminal_output', command: 'pytest', output, returncode: 1,
      session_id: 'sess-1', task_id: 'default', tool_call_id: 'call-1', env_type: 'local' })
  })

  it('fails open: short output, background output, no lc, a failing or empty reply all leave the output alone', () => {
    const ok = stub('{"output": "projected"}')
    const run = (args: string, env: NodeJS.ProcessEnv) => plugin(`print(json.dumps(lc._transform(${args})))`, env)
    expect(run(`command="pytest", output="short", returncode=0`, { LIGHTCODE_LC: ok.script })).toBe('null')
    expect(run(`command="pytest", output=${JSON.stringify(output)}, returncode=None`, { LIGHTCODE_LC: ok.script })).toBe('null')
    expect(run(`command="pytest", output=${JSON.stringify(output)}, returncode=0`, { LIGHTCODE_LC: ok.script, LIGHTCODE_DISABLE: '1' })).toBe('null')
    expect(run(`command="pytest", output=${JSON.stringify(output)}, returncode=0`, { LIGHTCODE_LC: join(temp(), 'missing') })).toBe('null')
    expect(run(`command="pytest", output=${JSON.stringify(output)}, returncode=0`, { LIGHTCODE_LC: stub('{"output": "projected"}', 1).script })).toBe('null')
    expect(run(`command="pytest", output=${JSON.stringify(output)}, returncode=0`, { LIGHTCODE_LC: stub('').script })).toBe('null')
    expect(run(`command="pytest", output=${JSON.stringify(output)}, returncode=0`, { LIGHTCODE_LC: stub('not json').script })).toBe('null')
  }, 30_000) // Seven Python processes: past the default 5 s on a loaded machine.

  it('declares its hooks in the manifest Hermes reads', () => {
    const manifest = readFileSync(join(adapter, 'lightcode', 'plugin.yaml'), 'utf8')
    const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string
    expect(manifest).toContain('name: lightcode\n')
    expect(manifest).toContain(`version: "${version}"\n`)
    expect(manifest).toContain('provides_hooks:\n  - pre_tool_call\n  - transform_terminal_output\n')
  })
})

const main = fileURLToPath(new URL('../src/main.ts', import.meta.url))

/** The real `lc` (this checkout's source), as Hermes would find it. */
function realLc(home: string) {
  const script = join(temp(), 'lc')
  writeFileSync(script, `#!/bin/sh\nLIGHTCODE_HOME='${home}' exec '${process.execPath}' --conditions=source '${main}' "$@"\n`)
  chmodSync(script, 0o755)
  return script
}

/**
 * A stand-in for Hermes's `agent.context_compressor` with the call order of the real one (0.22.5): shorten the
 * tool results in the head, build the summary prompt, then assemble head + summary + tail.
 */
function fakeHermes() {
  const dir = temp()
  for (const pkg of ['agent', 'hermes_cli']) { mkdirSync(join(dir, pkg)); writeFileSync(join(dir, pkg, '__init__.py'), '') }
  writeFileSync(join(dir, 'hermes_cli', 'config.py'), 'def load_config_readonly():\n    return {"context": {"engine": "lightcode"}}\n')
  writeFileSync(join(dir, 'agent', 'context_compressor.py'), `import json
class ContextCompressor:
    def __init__(self, model="", quiet_mode=False, threshold_percent=0.5, protect_first_n=3):
        self._session_id = "sess-9"
    def compress(self, messages, current_tokens=None, focus_topic=None, force=False, memory_context="", bypass_cooldown=False):
        pruned = [dict(m) for m in messages]
        pruned[1]["content"] = "[terminal] ran cat head.log -> exit 0, 300 lines output"
        self.last_prompt = self._build_summary_prompt("window", 100, None, "", True)
        return self._assemble_compressed(pruned, 2, len(pruned) - 1, None, "Hermes summary of the window.")
    def _build_summary_prompt(self, content_to_summarize, summary_budget, focus_topic, memory_context, has_user_turn):
        return "BASE PROMPT"
    def _assemble_compressed(self, messages, compress_start, compress_end, scan, summary):
        return messages[:compress_start] + [{"role": "user", "content": summary, "_compressed_summary": True}] + messages[compress_end:]
    def get_tool_schemas(self):
        return []
    def handle_tool_call(self, name, args, **kwargs):
        return json.dumps({"error": "unknown tool"})
def is_compaction_summary_message(message):
    return isinstance(message, dict) and message.get("_compressed_summary") is True
`)
  return dir
}

const rows = (tag: string) => Array.from({ length: 300 }, (_, i) => `${tag} ${i}: ${(i * 7919) % 10007}`).join('\\n')
const history = `[
  {"role": "assistant", "content": "", "tool_calls": [{"id": "c0", "type": "function", "function": {"name": "terminal", "arguments": "{\\"command\\": \\"cat head.log\\"}"}}]},
  {"role": "tool", "tool_call_id": "c0", "name": "terminal", "content": "${rows('head')}"},
  {"role": "user", "content": "Now look at the build log."},
  {"role": "assistant", "content": "Reading it.", "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "terminal", "arguments": "{\\"command\\": \\"cat build.log\\"}"}}]},
  {"role": "tool", "tool_call_id": "c1", "name": "terminal", "content": "${rows('build')}"},
  {"role": "user", "content": "What failed?"}
]`

describe.skipIf(!python)('Hermes plugin: LightShadow context engine', () => {
  it('keeps Hermes\'s summary, appends the catalog, marks the shortened head result and recalls it', () => {
    const home = temp(), fakes = fakeHermes()
    const result = plugin(`
sys.path.insert(0, ${JSON.stringify(fakes)})
engines = []
class Ctx:
    def register_hook(self, name, fn): pass
    def register_context_engine(self, engine): engines.append(engine)
lc.register(Ctx())
engine = engines[0]
out = engine.compress(json.loads(${JSON.stringify(history)}))
summary = next(m["content"] for m in out if m.get("_compressed_summary"))
ids = __import__("re").findall(r"observation_id: (o-[a-f0-9]{12})", summary)
recall = json.loads(engine.handle_tool_call("lightcode_recall", {"observation_id": ids[0], "query": "head 250:"}))
print(json.dumps({"name": engine.name, "prompt": engine.last_prompt, "summary": summary, "head": out[1]["content"], "ids": ids,
  "tools": [t["name"] for t in engine.get_tool_schemas()], "recall": recall}))`, { LIGHTCODE_LC: realLc(home) })
    const parsed = JSON.parse(result)
    expect(parsed.name).toBe('lightcode')
    expect(parsed.prompt).toMatch(/^BASE PROMPT\n\nAfter this compaction every tool result/u)
    expect(parsed.summary).toMatch(/^Hermes summary of the window\./u)
    // Hermes already keeps the user's messages; LightCode does not add a second copy.
    expect(parsed.summary).not.toContain('User messages (verbatim)')
    expect(parsed.ids).toHaveLength(2)
    expect(parsed.head).toMatch(/\[LightCode kept the full output: lightcode_recall observation_id o-[a-f0-9]{12}\]$/u)
    expect(parsed.tools).toEqual(['lightcode_recall'])
    expect(parsed.recall.result).toContain(`head 250: ${(250 * 7919) % 10007}`)
  })

  it('fails open to Hermes\'s own compaction without lc, and registers no engine unless chosen', () => {
    const fakes = fakeHermes()
    const result = plugin(`
sys.path.insert(0, ${JSON.stringify(fakes)})
engines = []
class Ctx:
    def register_hook(self, name, fn): pass
    def register_context_engine(self, engine): engines.append(engine)
lc.register(Ctx())
out = engines[0].compress(json.loads(${JSON.stringify(history)}))
import hermes_cli.config as cfg
cfg.load_config_readonly = lambda: {"context": {"engine": "compressor"}}
lc.register(Ctx())
print(json.dumps({"summary": next(m["content"] for m in out if m.get("_compressed_summary")), "engines": len(engines)}))`, { LIGHTCODE_LC: join(temp(), 'missing') })
    expect(JSON.parse(result)).toEqual({ summary: 'Hermes summary of the window.', engines: 1 })
  })

  it('carries the same summary instruction and recall tool as the TypeScript core', async () => {
    const { SHADOW_ASSISTED_INSTRUCTION, RECALL_TOOL_DESCRIPTION, RECALL_INPUT_SCHEMA } = await import('@lightcode-ai/mechanisms')
    const parsed = JSON.parse(plugin('from lightcode import shadow\nprint(json.dumps([shadow.SUMMARY_INSTRUCTION, shadow.RECALL_DESCRIPTION, shadow.RECALL_PARAMETERS]))'))
    expect(parsed).toEqual([SHADOW_ASSISTED_INSTRUCTION, RECALL_TOOL_DESCRIPTION, RECALL_INPUT_SCHEMA])
  })
})
