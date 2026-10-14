/**
 * Self-evolution, end to end: the plugins installed in DeepSeek Harness and pi
 * record evidence, `lc evolve` (from the @lightcode/cli package on the
 * registry) runs a scripted learner that writes a rule, verifies and adopts it,
 * and the next session on each host reads the learned projection.
 */
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureTool, VERSIONS } from './lib/hosts.mjs'
import { startMockLlm, toolResults } from './lib/mock-llm.mjs'
import { childEnv, run, runAsync } from './lib/run.mjs'
import { journal } from './lib/verify.mjs'

const PROGRESS = Array.from({ length: 120 }, (_, i) => `[${String(i + 1).padStart(3)}/120] Compiling module_${i}`).join('\n')
const LEARNED = 'Finished in 3.1s\n[120 progress lines omitted]\n'

function fixture(work) {
  mkdirSync(work, { recursive: true })
  writeFileSync(join(work, 'build.sh'), `#!/bin/sh\ncat <<'EOF'\n${PROGRESS}\nFinished in 3.1s\nEOF\n`)
  chmodSync(join(work, 'build.sh'), 0o755)
}

function learner(dir) {
  const script = join(dir, 'learner.sh')
  writeFileSync(script, `#!/bin/sh
set -e
mkdir -p rules-work/rules
cat > rules-work/index.json <<'JSON'
{ "schemaVersion": 1, "rules": [{ "id": "build-progress", "file": "rules/build-progress.js", "transformation": "noise-removal" }] }
JSON
cat > rules-work/rules/build-progress.js <<'JS'
defineRule({ project(input, lc) {
  if (!input.argv || input.argv[0] !== './build.sh') return null
  return lc.keepLines(input.raw, line => !/^\\[\\s*\\d+\\/\\d+\\] Compiling /.test(line.text), n => '[' + n + ' progress lines omitted]\\n')
} })
JS
./check
`)
  return `sh ${script}`
}

/** The last tool result of the last request. */
const lastResult = requests => toolResults(requests.at(-1)).at(-1)?.text

export async function runEvolve({ cache, root, registry, log }) {
  const base = join(root, 'evolve')
  const lightcodeHome = join(base, 'lightcode')
  mkdirSync(base, { recursive: true })
  // The CLI, installed from the registry the way a user would.
  const cliPrefix = join(base, 'cli')
  run('npm', ['install', '--global', '--prefix', cliPrefix, '--no-fund', '--no-audit', '@lightcode/cli'], { cwd: base,
    env: childEnv({ ...registry.env, npm_config_cache: join(cache, 'npm-cache') }) })
  const lc = join(cliPrefix, 'bin', 'lc')
  const mock = await startMockLlm({ commands: ['./build.sh'], toolArguments: command => ({ description: 'Build', command }) })
  const pnpmBin = ensureTool(cache, 'pnpm', VERSIONS.pnpm)
  try {
    const dshVersion = VERSIONS.dsh.at(-1), piVersion = VERSIONS.pi.at(-1)
    const dshBin = ensureTool(cache, 'dsh', dshVersion), piBin = ensureTool(cache, 'pi', piVersion)
    const dshHome = join(base, 'dsh-home'), agentDir = join(base, 'pi-agent'), work = join(base, 'work')
    mkdirSync(dshHome, { recursive: true }); mkdirSync(agentDir, { recursive: true })
    fixture(work)
    const env = childEnv({ ...registry.env, DSH_HOME: dshHome, PI_CODING_AGENT_DIR: agentDir, LIGHTCODE_HOME: lightcodeHome, MOCK_LLM_API_KEY: 'e2e',
      PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0', PATH: `${pnpmBin}:${dshBin}:${process.env.PATH}`,
      npm_config_cache: join(cache, 'npm-cache'), npm_config_store_dir: join(cache, 'pnpm-store') })
    run(join(dshBin, 'dsh'), ['plugin', '--profile', 'headless', 'add', '@lightcode/dsh'], { cwd: base, env })
    writeFileSync(join(dshHome, 'profiles', 'headless', 'cordis.patch.yml'), `- id: llm-pi-ai
  config:
    providers:
      mock:
        apiKeyEnv: MOCK_LLM_API_KEY
        api: openai-completions
        baseURL: ${mock.url}
        models:
          - id: mock-model
- id: agent-default-model
  config:
    provider: mock
    model: mock-model
`)
    run(join(piBin, 'pi'), ['install', 'npm:@lightcode/pi'], { cwd: base, env })
    writeFileSync(join(agentDir, 'models.json'), JSON.stringify({ providers: { mock: { baseUrl: mock.url, api: 'openai-completions', apiKey: 'e2e',
      models: [{ id: 'mock-model', contextWindow: 128000, maxTokens: 4096 }] } } }, null, 2))
    const dsh = async () => {
      const before = mock.requests.length
      const result = await runAsync(join(dshBin, 'dsh'), ['--profile', 'headless', 'Build the project.'], { cwd: work, env })
      assert.equal(result.status, 0, result.stderr)
      return lastResult(mock.requests.slice(before))
    }
    const pi = async () => {
      const before = mock.requests.length
      const result = await runAsync(join(piBin, 'pi'), ['-p', '--provider', 'mock', '--model', 'mock-model', '--session-dir', join(base, 'pi-sessions'), 'Build the project.'],
        { cwd: work, env: { ...env, PI_OFFLINE: '1' } })
      assert.equal(result.status, 0, result.stderr)
      return lastResult(mock.requests.slice(before))
    }

    // 1. Before learning: both hosts deliver the build output in full, and keep it as evidence.
    assert.match(await dsh(), /\[120\/120\] Compiling module_119/)
    assert.match(await pi(), /\[120\/120\] Compiling module_119/)
    const evidence = journal(lightcodeHome, 'dsh').concat(journal(lightcodeHome, 'pi')).filter(record => record.type === 'economy/decision')
    assert.deepEqual(evidence.map(record => [record.outcome, record.raw.stored, record.layout !== undefined]), [['passed', true, true], ['passed', true, true]])

    // 2. lc evolve: the scripted learner writes a rule; verification accepts it.
    const evolved = run(lc, ['evolve', '--learner', learner(base), '--json'], { cwd: base, env })
    const report = JSON.parse(evolved.stdout)
    assert.equal(report.accepted, true, evolved.stdout + evolved.stderr)
    // The same command and output on both hosts is one observation (seen twice).
    assert.equal(report.cases, 1)
    assert.match(run(lc, ['rules'], { cwd: base, env }).stdout, new RegExp(`active: ${report.adopted.slice(0, 12)}`))
    log(`evolve: lc evolve adopted ${report.adopted.slice(0, 12)} (+${report.gainTokens} tokens on ${report.cases} observations) ✓`)

    // 3. New sessions on both hosts read the learned projection.
    const learnedDsh = await dsh(), learnedPi = await pi()
    assert.equal(learnedDsh, LEARNED)
    assert.ok(learnedPi.startsWith(LEARNED), learnedPi)
    for (const host of ['dsh', 'pi']) {
      const last = journal(lightcodeHome, host).filter(record => record.type === 'economy/decision').at(-1)
      assert.equal(last.filter, 'learned-rule')
      assert.equal(last.rule, 'build-progress')
      assert.equal(last.learnedRulesHash, report.adopted)
    }
    log(`evolve: DSH ${dshVersion} and pi ${piVersion} apply the learned rule in new sessions ✓`)

    // 4. Rollback: the next sessions read the full output again.
    run(lc, ['rules', 'rollback'], { cwd: base, env })
    assert.match(await dsh(), /\[120\/120\] Compiling module_119/)
    log('evolve: lc rules rollback ✓')
  } finally {
    await mock.close()
  }
}
