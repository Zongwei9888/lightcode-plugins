/**
 * pi's interactive side, driven through tmux: the status bar and `/lightcode`
 * in a TUI session, and switching the extension off and on in `pi config`
 * (the screen pi offers for enabling installed resources). Skipped without
 * tmux.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createFixture, COMMANDS } from './lib/fixture.mjs'
import { ensureTool, VERSIONS } from './lib/hosts.mjs'
import { startMockLlm } from './lib/mock-llm.mjs'
import { childEnv, hasCommand, run, runAsync } from './lib/run.mjs'
import { journal } from './lib/verify.mjs'

const tmux = (...args) => spawnSync('tmux', args, { encoding: 'utf8' })

/** One detached tmux session running `command` with `env`; `screen()` returns the visible text. */
function terminal(name, { cwd, env, command }) {
  tmux('kill-session', '-t', name)
  const vars = Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`])
  const started = tmux('new-session', '-d', '-s', name, '-x', '160', '-y', '45', '-c', cwd, ...vars, ...command)
  assert.equal(started.status, 0, started.stderr)
  const screen = () => tmux('capture-pane', '-t', name, '-p', '-S', '-300').stdout
  return {
    screen,
    keys: (...keys) => tmux('send-keys', '-t', name, ...keys),
    waitFor: async (pattern, what, timeoutMs = 60_000) => {
      const deadline = Date.now() + timeoutMs
      while (!pattern.test(screen())) {
        if (Date.now() > deadline) throw new Error(`pi TUI: timed out waiting for ${what}\n${screen()}`)
        await new Promise(resolve => setTimeout(resolve, 250))
      }
    },
    close: () => tmux('kill-session', '-t', name),
  }
}

export async function runPiTui({ cache, root, registry, log }) {
  if (!hasCommand('tmux')) { log('pi TUI: skipped (tmux not installed)'); return }
  const version = VERSIONS.pi.at(-1)
  const pi = join(ensureTool(cache, 'pi', version), 'pi')
  const base = join(root, `pi-tui-${version}`)
  const agentDir = join(base, 'agent'), work = join(base, 'work'), lightcodeHome = join(base, 'lightcode')
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(work, { recursive: true })
  createFixture(work)
  const commands = [COMMANDS.search, COMMANDS.tests, COMMANDS.diff, COMMANDS.plain]
  const mock = await startMockLlm({ commands })
  writeFileSync(join(agentDir, 'models.json'), JSON.stringify({ providers: { mock: { baseUrl: mock.url, api: 'openai-completions', apiKey: 'e2e',
    models: [{ id: 'mock-model', contextWindow: 128000, maxTokens: 4096 }] } } }))
  const env = childEnv({ ...registry.env, PI_CODING_AGENT_DIR: agentDir, LIGHTCODE_HOME: lightcodeHome, PI_SKIP_VERSION_CHECK: '1',
    PI_TELEMETRY: '0', PI_OFFLINE: '1', npm_config_cache: join(cache, 'npm-cache') })
  // tmux sessions inherit the tmux server's environment: pass everything the TUI needs (local addresses bypass any proxy).
  const vars = Object.fromEntries(['PI_CODING_AGENT_DIR', 'LIGHTCODE_HOME', 'PI_SKIP_VERSION_CHECK', 'PI_TELEMETRY', 'PI_OFFLINE', 'NO_PROXY', 'no_proxy']
    .map(key => [key, env[key]]))
  const settings = () => JSON.parse(readFileSync(join(agentDir, 'settings.json'), 'utf8'))
  const decisions = () => journal(lightcodeHome, 'pi').filter(record => record.type === 'economy/decision').length
  const printRun = async () => {
    const result = await runAsync(pi, ['-p', '--provider', 'mock', '--model', 'mock-model', 'Run the fixture commands.'], { cwd: work, env })
    assert.equal(result.status, 0, result.stderr)
  }
  const toggleInConfig = async (expected) => {
    const config = terminal('lightcode-pi-config', { cwd: work, env: vars, command: [pi, 'config'] })
    try {
      await config.waitFor(/\[[x ]\] dist\/extension\.js/, 'the LightCode extension in pi config')
      config.keys('Space')
      await config.waitFor(new RegExp(`\\[${expected ? 'x' : ' '}\\] dist/extension\\.js`), `the extension ${expected ? 'on' : 'off'}`)
      config.keys('Escape')
      const deadline = Date.now() + 10_000
      while (JSON.stringify(settings().packages).includes('-dist/extension.js') === expected) {
        if (Date.now() > deadline) throw new Error(`pi config did not save the extension ${expected ? 'on' : 'off'}`)
        await new Promise(resolve => setTimeout(resolve, 200))
      }
    } finally { config.close() }
  }
  try {
    run(pi, ['install', 'npm:@lightcode/pi'], { cwd: base, env })

    // 1. A TUI session: the status bar shows the savings, /lightcode explains them.
    const session = terminal('lightcode-pi-tui', { cwd: work, env: vars, command: [pi, '--provider', 'mock', '--model', 'mock-model'] })
    try {
      await session.waitFor(/mock-model/, 'pi to start')
      session.keys('Run the fixture commands.', 'Enter')
      await session.waitFor(/^ ?done\s*$/m, 'the scripted turn to finish', 120_000)
      await session.waitFor(/LightCode −\d/, 'the LightCode status')
      session.keys('/lightcode')
      await session.waitFor(/lightcode .*LightCode: savings in this session/, '/lightcode in the command list')
      session.keys('Enter')
      await session.waitFor(/LightCode Economy: 3 outputs filtered, ~\S+ tokens saved, 1 passed unchanged/, 'the /lightcode report')
    } finally { session.close() }
    log(`pi ${version} TUI: status bar ✓ /lightcode ✓`)

    // 2. pi config: off means not loaded at all; on again means filtering again.
    await toggleInConfig(false)
    const before = decisions()
    await printRun()
    assert.equal(decisions(), before, 'a disabled extension still filtered')
    await toggleInConfig(true)
    await printRun()
    assert.equal(decisions(), before + commands.length, 'the re-enabled extension did not filter')
    log(`pi ${version} TUI: pi config off/on ✓`)
  } finally {
    await mock.close()
  }
}
