/**
 * DeepSeek Harness Web UI (`dsh web`) in a real browser, through the Plugins
 * page flow in lib/plugins-page.mjs.
 *
 * `dsh web` runs with its own HOME, DSH_HOME and LIGHTCODE_HOME, and its
 * Documents directory (which DSH otherwise asks the OS for, ignoring HOME) is
 * configured into the run directory, so the default workspace is the fixture
 * and nothing is written outside the run directory.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createFixture } from './lib/fixture.mjs'
import { ensureLibrary, ensureTool, VERSIONS } from './lib/hosts.mjs'
import { startMockLlm } from './lib/mock-llm.mjs'
import { COMMAND_LIST, exercisePluginsPage, mockProfilePatch } from './lib/plugins-page.mjs'
import { childEnv, run } from './lib/run.mjs'

async function startWeb({ dsh, env, cwd }) {
  const child = spawn(dsh, ['--profile', 'web', '--no-open', '--port', '0', '--host', '127.0.0.1'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  const deadline = Date.now() + 120_000
  let url
  while (!(url = output.match(/https?:\/\/127\.0\.0\.1:\d+\/\S*/)?.[0])) {
    if (Date.now() > deadline || child.exitCode !== null) throw new Error(`dsh web did not start:\n${output}`)
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return { url, output: () => output, stop: () => new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM') }) }
}

export async function runWeb({ cache, root, registry, log }) {
  const { chromium } = await import(pathToFileURL(join(ensureLibrary(cache, 'playwright-core', VERSIONS.playwright), 'index.mjs')).href)
  const pnpmBin = ensureTool(cache, 'pnpm', VERSIONS.pnpm)
  for (const version of VERSIONS.dsh) {
    const bin = ensureTool(cache, 'dsh', version)
    const dsh = join(bin, 'dsh')
    const base = join(root, `web-${version}`)
    const home = join(base, 'home'), dshHome = join(base, 'dsh-home'), lightcodeHome = join(base, 'lightcode')
    const workspace = join(home, 'Documents', 'deepseek-harness', 'default-workspace')
    const shots = join(base, 'screenshots')
    for (const dir of [workspace, dshHome, shots]) mkdirSync(dir, { recursive: true })
    createFixture(workspace)
    const mock = await startMockLlm({ commands: COMMAND_LIST, toolArguments: command => ({ description: `Fixture: ${command}`, command }) })
    const env = childEnv({ ...registry.env, HOME: home, DSH_HOME: dshHome, LIGHTCODE_HOME: lightcodeHome, MOCK_LLM_API_KEY: 'e2e',
      PATH: `${pnpmBin}:${bin}:${process.env.PATH}`, npm_config_cache: join(cache, 'npm-cache'), npm_config_store_dir: join(cache, 'pnpm-store') })
    run(dsh, ['plugin', '--profile', 'web', 'list'], { cwd: base, env, allowFailure: true })
    const profileDir = join(dshHome, 'profiles', 'web')
    writeFileSync(join(profileDir, 'cordis.patch.yml'), mockProfilePatch(mock.url, join(home, 'Documents')))
    const web = await startWeb({ dsh, env, cwd: base })
    const browser = await chromium.launch({ headless: true, ...process.env.LIGHTCODE_E2E_BROWSER_PATH
      ? { executablePath: process.env.LIGHTCODE_E2E_BROWSER_PATH } : { channel: process.env.LIGHTCODE_E2E_BROWSER_CHANNEL ?? 'chrome' } })
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(error.message))
    const shot = name => page.screenshot({ path: join(shots, `${name}.png`) })
    try {
      await page.goto(web.url)
      await exercisePluginsPage({ page, label: `web ${version}`, profileDir, lightcodeHome, workspace, mock, shot, log, pageErrors })
      log(`web ${version}: screenshots in ${shots}`)
    } catch (error) {
      await shot('failure').catch(() => {})
      throw new Error(`${error.message}\nscreenshots: ${shots}\n--- dsh web output (tail)\n${web.output().slice(-3000)}`, { cause: error })
    } finally {
      await browser.close()
      await web.stop()
      await mock.close()
    }
  }
}
