/**
 * DeepSeek Harness, end to end: install @lightcode/dsh from a registry with
 * `dsh plugin add` exactly as a user would, run real headless sessions against
 * the scripted model, and check what the model received, what the session log
 * kept and what LightCode stored. Then observe mode and removal.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createFixture, COMMANDS } from './lib/fixture.mjs'
import { ensureTool, VERSIONS } from './lib/hosts.mjs'
import { startMockLlm } from './lib/mock-llm.mjs'
import { childEnv, hasCommand, run, runAsync } from './lib/run.mjs'
import { delivered, dshSpilled, journal, verifyDeliveries } from './lib/verify.mjs'

const COMMAND_LIST = [COMMANDS.search, COMMANDS.tests, COMMANDS.diff, COMMANDS.plain, COMMANDS.wide, COMMANDS.testsWithStderr]
const EXPECT_APPLY = ['projected', 'projected', 'projected', 'passed', 'projected', 'projected']
const EXPECT_OBSERVE = ['previewed', 'previewed', 'previewed', 'passed', 'previewed', 'previewed']
const EVIDENCE = { 1: ['necessary failure evidence', '[exit code: 1]'], 2: ['diff --git a/src/f0.ts'], 4: ['wide/w9.ts:'],
  5: ['necessary failure evidence', '\n[stderr]\n', '[exit code: 1]'] }

function profilePatch(mockUrl, lightcodeMode) {
  return `- id: llm-pi-ai
  config:
    providers:
      mock:
        apiKeyEnv: MOCK_LLM_API_KEY
        api: openai-completions
        baseURL: ${mockUrl}
        models:
          - id: mock-model
- id: agent-default-model
  config:
    provider: mock
    model: mock-model
${lightcodeMode ? `- id: lightcode\n  config:\n    mode: ${lightcodeMode}\n` : ''}`
}

/** Tool results as the session log kept them (needs the zstd CLI; DSH appends one zstd frame per write). */
function sessionToolResults(dshHome) {
  if (!hasCommand('zstd')) return undefined
  const files = []
  const walk = dir => { for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else if (entry.name.endsWith('.jsonl.zstd')) files.push(path)
  } }
  walk(join(dshHome, 'sessions'))
  return files.flatMap(file => run('zstd', ['-dcq', file]).stdout.trim().split('\n').map(line => JSON.parse(line)))
    .filter(event => event.type === 'tool/result').map(event => event.data.message.content.map(part => part.text ?? '').join(''))
}

async function session({ dsh, env, work, mock, lightcodeHome }) {
  const before = mock.requests.length
  const result = await runAsync(dsh, ['--profile', 'headless', 'Run the fixture commands.'], { cwd: work, env })
  assert.equal(result.status, 0, `dsh headless failed:\n${result.stderr}`)
  const requests = mock.requests.slice(before)
  // Kept beside LightCode's data for inspection when a check fails.
  writeFileSync(join(lightcodeHome, '..', `${basename(lightcodeHome)}.requests.json`), JSON.stringify(requests, null, 1))
  return { requests, lightcodeHome }
}

export async function runDsh({ cache, root, registry, log }) {
  const pnpmBin = ensureTool(cache, 'pnpm', VERSIONS.pnpm)
  const results = []
  for (const version of VERSIONS.dsh) {
    const bin = ensureTool(cache, 'dsh', version)
    const dsh = join(bin, 'dsh')
    const base = join(root, `dsh-${version}`)
    const dshHome = join(base, 'home'), work = join(base, 'work')
    mkdirSync(dshHome, { recursive: true })
    mkdirSync(work, { recursive: true })
    createFixture(work)
    const mock = await startMockLlm({ commands: COMMAND_LIST, toolArguments: command => ({ description: 'Run a fixture command', command }) })
    const envFor = lightcodeHome => childEnv({ ...registry.env, DSH_HOME: dshHome, LIGHTCODE_HOME: lightcodeHome, MOCK_LLM_API_KEY: 'e2e',
      PATH: `${pnpmBin}:${bin}:${process.env.PATH}`, npm_config_cache: join(cache, 'npm-cache'), npm_config_store_dir: join(cache, 'pnpm-store') })
    try {
      // 1. Install like a user: the package name, resolved from the registry.
      const install = run(dsh, ['plugin', '--profile', 'headless', 'add', '@lightcode/dsh'], { cwd: base, env: envFor(join(base, 'lc-install')) })
      const profileDir = join(dshHome, 'profiles', 'headless')
      const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
      assert.ok(manifest.dsh.profile.bundles.includes('@lightcode/dsh'), `bundle not selected:\n${install.stdout}${install.stderr}`)
      assert.match(manifest.dependencies['@lightcode/dsh'], /^\d+\.\d+\.\d+/, 'not installed from the registry')
      const dump = run(dsh, ['--profile', 'headless', '--dump-config'], { cwd: base, env: envFor(join(base, 'lc-install')) }).stdout
      assert.match(dump, /# == @lightcode\/dsh\n- id: lightcode\n {2}name: '@lightcode\/dsh'/)

      // 2. Apply mode: the model reads projections; the session log keeps what it read.
      writeFileSync(join(profileDir, 'cordis.patch.yml'), profilePatch(mock.url))
      const apply = await session({ dsh, env: envFor(join(base, 'lc-apply')), work, mock, lightcodeHome: join(base, 'lc-apply') })
      const summary = verifyDeliveries({ ...apply, host: 'dsh', commands: COMMAND_LIST, expect: EXPECT_APPLY, evidence: EVIDENCE })
      const logged = sessionToolResults(dshHome)
      if (logged) assert.deepEqual(logged, delivered(apply.requests).map(result => result.text), 'session log differs from what the model read')
      log(`dsh ${version}: apply ✓ ${summary.map(item => `${item.filter ?? item.outcome} ${item.rawTokens}→${item.projectedTokens ?? item.rawTokens}`).join(', ')}${logged ? '; session log ✓' : '; session log skipped (no zstd)'}`)

      // 3. Observe mode from the profile patch: originals delivered, previews journaled.
      writeFileSync(join(profileDir, 'cordis.patch.yml'), profilePatch(mock.url, 'observe'))
      const observe = await session({ dsh, env: envFor(join(base, 'lc-observe')), work, mock, lightcodeHome: join(base, 'lc-observe') })
      // Passed through, the 60 KB search is bounded by DSH's own spill policy, exactly as without LightCode.
      const spilled = { original: command => command === COMMANDS.wide ? run('sh', ['-c', command], { cwd: work }).stdout : undefined, accepts: dshSpilled }
      const observed = verifyDeliveries({ ...observe, host: 'dsh', commands: COMMAND_LIST, expect: EXPECT_OBSERVE, hostBounded: spilled })
      assert.ok(observed[4].bounded, 'the wide search was expected to exceed DSH\'s inline budget')
      log(`dsh ${version}: observe ✓`)

      // 4. Remove: the layer goes away and nothing is filtered or recorded.
      writeFileSync(join(profileDir, 'cordis.patch.yml'), profilePatch(mock.url))
      run(dsh, ['plugin', '--profile', 'headless', 'remove', '@lightcode/dsh'], { cwd: base, env: envFor(join(base, 'lc-removed')) })
      const after = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
      assert.ok(!after.dsh.profile.bundles.includes('@lightcode/dsh'))
      assert.equal(after.dependencies?.['@lightcode/dsh'], undefined)
      const removed = await session({ dsh, env: envFor(join(base, 'lc-removed')), work, mock, lightcodeHome: join(base, 'lc-removed') })
      assert.deepEqual(journal(join(base, 'lc-removed'), 'dsh'), [])
      assert.equal(delivered(removed.requests).length, COMMAND_LIST.length)
      log(`dsh ${version}: remove ✓`)
      results.push({ host: 'dsh', version, summary })
    } finally {
      await mock.close()
    }
  }
  return results
}
