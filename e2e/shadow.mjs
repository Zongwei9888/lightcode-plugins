/**
 * LightShadow, end to end, on both hosts: a session long enough to make the
 * host compact, then the model reads a compacted tool result again with
 * `lightcode_recall`. Checks that the checkpoint the model receives carries
 * the user's exact words and the catalog, that the recalled text is exactly
 * what the model first read, and what LightCode journaled.
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureTool, VERSIONS } from './lib/hosts.mjs'
import { startMockLlm } from './lib/mock-llm.mjs'
import { childEnv, run, runAsync } from './lib/run.mjs'
import { SHADOW_PROMPT as PROMPT, checkpointRequest, readBack, shadowScript } from './lib/shadow-script.mjs'

export async function runShadow({ cache, root, registry, log, hosts }) {
  const pnpmBin = ensureTool(cache, 'pnpm', VERSIONS.pnpm)
  if (hosts.includes('dsh')) {
    for (const version of VERSIONS.dsh) {
      const bin = ensureTool(cache, 'dsh', version)
      const dsh = join(bin, 'dsh')
      const base = join(root, `shadow-dsh-${version}`)
      const dshHome = join(base, 'home'), work = join(base, 'work'), lightcodeHome = join(base, 'lc')
      mkdirSync(dshHome, { recursive: true })
      mkdirSync(work, { recursive: true })
      const { state, script } = shadowScript()
      const mock = await startMockLlm(script)
      const env = childEnv({ ...registry.env, DSH_HOME: dshHome, LIGHTCODE_HOME: lightcodeHome, MOCK_LLM_API_KEY: 'e2e',
        PATH: `${pnpmBin}:${bin}:${process.env.PATH}`, npm_config_cache: join(cache, 'npm-cache'), npm_config_store_dir: join(cache, 'pnpm-store') })
      try {
        run(dsh, ['plugin', '--profile', 'headless', 'add', '@lightcode/dsh'], { cwd: base, env })
        // A 60k-token window, compaction at 30% of it, a 3k-token tail: the session above must compact.
        writeFileSync(join(dshHome, 'profiles', 'headless', 'cordis.patch.yml'), `- id: llm-pi-ai
  config:
    providers:
      mock:
        apiKeyEnv: MOCK_LLM_API_KEY
        api: openai-completions
        baseURL: ${mock.url}
        models:
          - id: mock-model
            contextWindow: 60000
            maxTokens: 4000
- id: agent-default-model
  config:
    provider: mock
    model: mock-model
- id: compaction-basic
  config:
    thresholdRatio: 0.3
    headroomTokens: 0
    retainTokens: 3000
    maxTokens: 2000
`)
        const result = await runAsync(dsh, ['--profile', 'headless', PROMPT], { cwd: work, env, timeoutMs: 300_000 })
        writeFileSync(join(base, 'requests.json'), JSON.stringify(mock.requests, null, 1))
        writeFileSync(join(base, 'output.log'), `${result.stdout}\n--- stderr\n${result.stderr}`)
        assert.equal(result.status, 0, `dsh headless failed:\n${result.stderr}`)
        assert.ok(state.summaries > 0, `DSH never compacted:\n${result.stderr.slice(-2000)}`)
        assert.ok(state.recalledId, `the model found no catalog or no recall tool (last reply: ${JSON.stringify(mock.requests.at(-1)?.messages?.at(-1))?.slice(0, 300)})`)
        checkpointRequest(mock.requests)
        const { checkpoints } = readBack(mock.requests, state.recalledId, lightcodeHome, 'dsh')
        const kinds = checkpoints.map(record => record.kind)
        assert.ok(kinds.includes('lightshadow'), `no LightShadow checkpoint: ${kinds.join(', ')}`)
        log(`shadow dsh ${version}: compacted (${kinds.join(', ')}), checkpoint carries the user's words and the catalog ✓, recall returned the original ✓`)
      } finally {
        await mock.close()
      }
    }
  }
  if (hosts.includes('pi')) {
    for (const version of VERSIONS.pi) {
      const bin = ensureTool(cache, 'pi', version)
      const pi = join(bin, 'pi')
      const base = join(root, `shadow-pi-${version}`)
      const agentDir = join(base, 'agent'), work = join(base, 'work'), lightcodeHome = join(base, 'lc')
      mkdirSync(agentDir, { recursive: true })
      mkdirSync(work, { recursive: true })
      const { state, script } = shadowScript()
      const mock = await startMockLlm(script)
      writeFileSync(join(agentDir, 'models.json'), JSON.stringify({ providers: { mock: { baseUrl: mock.url, api: 'openai-completions', apiKey: 'e2e',
        models: [{ id: 'mock-model', contextWindow: 40000, maxTokens: 4096 }] } } }, null, 2))
      const env = childEnv({ ...registry.env, PI_CODING_AGENT_DIR: agentDir, LIGHTCODE_HOME: lightcodeHome,
        PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0', npm_config_cache: join(cache, 'npm-cache') })
      try {
        run(pi, ['install', 'npm:@lightcode/pi'], { cwd: base, env })
        // Compact once the context passes 40k − 12k tokens, keeping about 3k recent tokens.
        const settingsFile = join(agentDir, 'settings.json')
        const settings = JSON.parse(run('cat', [settingsFile]).stdout)
        writeFileSync(settingsFile, JSON.stringify({ ...settings, compaction: { enabled: true, reserveTokens: 12000, keepRecentTokens: 3000 } }, null, 2))
        const result = await runAsync(pi, ['-p', '--provider', 'mock', '--model', 'mock-model', '--session-dir', join(base, 'sessions'), PROMPT],
          { cwd: work, env: { ...env, PI_OFFLINE: '1' }, timeoutMs: 300_000 })
        writeFileSync(join(base, 'requests.json'), JSON.stringify(mock.requests, null, 1))
        writeFileSync(join(base, 'output.log'), `${result.stdout}\n--- stderr\n${result.stderr}`)
        assert.equal(result.status, 0, `pi failed:\n${result.stdout}\n${result.stderr}`)
        assert.ok(state.summaries > 0, `pi never compacted:\n${result.stderr.slice(-2000)}`)
        assert.ok(state.recalledId, `the model found no catalog or no recall tool (last reply: ${JSON.stringify(mock.requests.at(-1)?.messages?.at(-1))?.slice(0, 300)})`)
        checkpointRequest(mock.requests)
        const { checkpoints } = readBack(mock.requests, state.recalledId, lightcodeHome, 'pi')
        assert.ok(checkpoints.some(record => record.kind === 'lightshadow'), 'no LightShadow checkpoint')
        log(`shadow pi ${version}: compacted (${checkpoints.map(record => record.kind).join(', ')}), checkpoint carries the user's words and the catalog ✓, recall returned the original ✓`)
      } finally {
        await mock.close()
      }
    }
  }
}
