/**
 * pi, end to end: `pi install npm:@tokenwise/pi` from a registry exactly as a
 * user would, real print-mode sessions against the scripted model, then the
 * `--tokenwise observe` flag, removal, and the checkout install used in
 * development. Checks what the model received, what pi's session file kept
 * and what TokenWise stored.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createFixture, COMMANDS } from './lib/fixture.mjs'
import { ensureTool, VERSIONS } from './lib/hosts.mjs'
import { startMockLlm } from './lib/mock-llm.mjs'
import { childEnv, run, runAsync } from './lib/run.mjs'
import { delivered, journal, verifyDeliveries } from './lib/verify.mjs'

// pi cuts output over 50 KB to its tail before TokenWise sees it, so the wide search must pass through.
const COMMAND_LIST = [COMMANDS.search, COMMANDS.tests, COMMANDS.diff, COMMANDS.plain, COMMANDS.wide]
const EVIDENCE = { 1: ['necessary failure evidence', 'Command exited with code 1'], 2: ['diff --git a/src/f0.ts'] }

function sessionFiles(dir) {
  const files = []
  const walk = path => { for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(join(path, entry.name))
    else if (entry.name.endsWith('.jsonl')) files.push(join(path, entry.name))
  } }
  walk(dir)
  return files
}

async function session({ pi, env, work, mock, sessionDir, extraArgs = [] }) {
  const before = mock.requests.length
  const result = await runAsync(pi, ['-p', '--provider', 'mock', '--model', 'mock-model', '--session-dir', sessionDir, ...extraArgs,
    'Run the fixture commands.'], { cwd: work, env })
  assert.equal(result.status, 0, `pi failed:\n${result.stdout}\n${result.stderr}`)
  return mock.requests.slice(before)
}

export async function runPi({ cache, root, registry, log, checkout }) {
  const results = []
  for (const version of VERSIONS.pi) {
    const bin = ensureTool(cache, 'pi', version)
    const pi = join(bin, 'pi')
    const base = join(root, `pi-${version}`)
    const agentDir = join(base, 'agent'), work = join(base, 'work')
    mkdirSync(agentDir, { recursive: true })
    mkdirSync(work, { recursive: true })
    createFixture(work)
    const mock = await startMockLlm({ commands: COMMAND_LIST })
    writeFileSync(join(agentDir, 'models.json'), JSON.stringify({ providers: { mock: { baseUrl: mock.url, api: 'openai-completions', apiKey: 'e2e',
      models: [{ id: 'mock-model', contextWindow: 128000, maxTokens: 4096 }] } } }, null, 2))
    const envFor = tokenwiseHome => childEnv({ ...registry.env, PI_CODING_AGENT_DIR: agentDir, TOKENWISE_HOME: tokenwiseHome,
      PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0', npm_config_cache: join(cache, 'npm-cache') })
    try {
      // 1. Install like a user, from the registry.
      run(pi, ['install', 'npm:@tokenwise/pi'], { cwd: base, env: envFor(join(base, 'tokenwise-install')) })
      const settings = JSON.parse(readFileSync(join(agentDir, 'settings.json'), 'utf8'))
      assert.ok(JSON.stringify(settings.packages).includes('npm:@tokenwise/pi'), 'package not recorded in settings.json')
      const listed = run(pi, ['list'], { cwd: base, env: envFor(join(base, 'tokenwise-install')) }).stdout
      assert.match(listed, /@tokenwise\/pi/)

      // 2. A session: the model reads projections; pi's session file keeps every original.
      const lcApply = join(base, 'tokenwise-apply')
      const requests = await session({ pi, env: { ...envFor(lcApply), PI_OFFLINE: '1' }, work, mock, sessionDir: join(base, 'sessions-apply') })
      const summary = verifyDeliveries({ requests, tokenwiseHome: lcApply, host: 'pi', commands: COMMAND_LIST,
        expect: ['projected', 'projected', 'projected', 'passed', 'passed'], evidence: EVIDENCE })
      const entries = sessionFiles(join(base, 'sessions-apply')).flatMap(file => readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line)))
      const originals = entries.filter(entry => entry.type === 'message' && entry.message?.role === 'toolResult')
        .map(entry => entry.message.content.map(part => part.text ?? '').join(''))
      const all = journal(lcApply, 'pi')
      const records = all.filter(record => record.type === 'economy/decision')
      const ran = new Map(all.filter(record => record.type === 'economy/command-rewrite').map(record => [record.original, record.rewritten]))
      assert.equal(ran.get(COMMANDS.diff), 'git diff --no-color', 'pi normalizes git diff before it runs')
      for (const [index, command] of COMMAND_LIST.entries()) {
        const record = records.find(item => item.command === (ran.get(command) ?? command))
        assert.equal(createHash('sha256').update(originals[index]).digest('hex'), record.raw.sha256, `pi session lost the original of \`${command}\``)
      }
      assert.equal(entries.filter(entry => entry.type === 'context_edit').length, 3)
      assert.equal(records.findLast(record => record.command === COMMANDS.wide).reason, 'already-truncated')
      log(`pi ${version}: install ✓ apply ✓ ${summary.map(item => `${item.filter ?? item.outcome} ${item.rawTokens}→${item.projectedTokens ?? item.rawTokens}`).join(', ')}; session file keeps originals ✓`)

      // 3. The --tokenwise flag lowers the mode for one run.
      const lcObserve = join(base, 'tokenwise-observe')
      const observed = await session({ pi, env: { ...envFor(lcObserve), PI_OFFLINE: '1' }, work, mock, sessionDir: join(base, 'sessions-observe'), extraArgs: ['--tokenwise', 'observe'] })
      verifyDeliveries({ requests: observed, tokenwiseHome: lcObserve, host: 'pi', commands: COMMAND_LIST, expect: ['previewed', 'previewed', 'previewed', 'passed', 'passed'] })
      log(`pi ${version}: --tokenwise observe ✓`)

      // 4. Remove.
      run(pi, ['remove', 'npm:@tokenwise/pi'], { cwd: base, env: envFor(join(base, 'tokenwise-install')) })
      assert.doesNotMatch(JSON.stringify(JSON.parse(readFileSync(join(agentDir, 'settings.json'), 'utf8')).packages ?? []), /@tokenwise\/pi/)
      const lcRemoved = join(base, 'tokenwise-removed')
      const plain = await session({ pi, env: { ...envFor(lcRemoved), PI_OFFLINE: '1' }, work, mock, sessionDir: join(base, 'sessions-removed') })
      assert.deepEqual(journal(lcRemoved, 'pi'), [])
      assert.equal(delivered(plain).length, COMMAND_LIST.length)
      log(`pi ${version}: remove ✓`)

      // 5. From a checkout (contributors): a local path install loads the built bundle in place.
      if (checkout) {
        run(pi, ['install', checkout], { cwd: base, env: envFor(join(base, 'tokenwise-install')) })
        const lcLocal = join(base, 'tokenwise-local')
        const local = await session({ pi, env: { ...envFor(lcLocal), PI_OFFLINE: '1' }, work, mock, sessionDir: join(base, 'sessions-local') })
        verifyDeliveries({ requests: local, tokenwiseHome: lcLocal, host: 'pi', commands: COMMAND_LIST, expect: ['projected', 'projected', 'projected', 'passed', 'passed'] })
        run(pi, ['remove', checkout], { cwd: base, env: envFor(join(base, 'tokenwise-install')) })
        log(`pi ${version}: checkout install ✓`)
      }
      results.push({ host: 'pi', version, summary })
    } finally {
      await mock.close()
    }
  }
  return results
}
