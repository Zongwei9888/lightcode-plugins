/**
 * The DeepSeek Harness Desktop app, end to end: the Plugins page flow of
 * lib/plugins-page.mjs inside the real Electron window, with Desktop's own
 * bundled pnpm installing @lightcode/dsh into `$DSH_HOME/profiles/desktop`.
 *
 * Desktop is not distributed through npm, so this scenario needs an unpacked
 * application: set LIGHTCODE_E2E_DESKTOP_APP to `DeepSeek Harness.app`.
 * Desktop is built for macOS and Windows only, and this scenario drives the
 * macOS app: the one in the official DMG (download.deepseek.com) or a source
 * build (`pnpm run build && pnpm run package:desktop:mac:arm64:dir` in a
 * DeepSeek Harness checkout). The app runs with its own DSH_HOME, LIGHTCODE_HOME,
 * Electron user data and Documents directory, so nothing outside the run
 * directory changes; the empty log folder Electron creates outside the user
 * data directory is removed again. Its window appears on screen while the
 * scenario runs.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createFixture } from './lib/fixture.mjs'
import { ensureLibrary, VERSIONS } from './lib/hosts.mjs'
import { startMockLlm } from './lib/mock-llm.mjs'
import { COMMAND_LIST, exercisePluginsPage, mockProfilePatch, until } from './lib/plugins-page.mjs'
import { childEnv } from './lib/run.mjs'

function executableOf(app) {
  return join(app, 'Contents', 'MacOS', basename(app, '.app'))
}

export async function runDesktop({ cache, root, registry, log }) {
  const app = process.env.LIGHTCODE_E2E_DESKTOP_APP
  if (!app) { log('desktop: skipped (set LIGHTCODE_E2E_DESKTOP_APP to an unpacked DeepSeek Harness app)'); return }
  if (process.platform !== 'darwin') throw new Error('LIGHTCODE_E2E_DESKTOP_APP: the Desktop scenario drives the macOS app')
  const executable = executableOf(app)
  if (!existsSync(executable)) throw new Error(`LIGHTCODE_E2E_DESKTOP_APP: no executable at ${executable}`)
  const { chromium } = await import(pathToFileURL(join(ensureLibrary(cache, 'playwright-core', VERSIONS.playwright), 'index.mjs')).href)
  const base = join(root, 'desktop')
  const dshHome = join(base, 'dsh-home'), userData = join(base, 'electron-user-data'), lightcodeHome = join(base, 'lightcode')
  const documents = join(base, 'Documents'), workspace = join(documents, 'deepseek-harness', 'default-workspace')
  const shots = join(base, 'screenshots')
  for (const dir of [dshHome, userData, workspace, shots]) mkdirSync(dir, { recursive: true })
  createFixture(workspace)
  const mock = await startMockLlm({ commands: COMMAND_LIST, toolArguments: command => ({ description: `Fixture: ${command}`, command }) })
  // Desktop creates and owns profiles/desktop at first launch; the home layer applies to every profile.
  writeFileSync(join(dshHome, 'cordis.patch.yml'), mockProfilePatch(mock.url, documents))
  const env = childEnv({ ...registry.env, DSH_HOME: dshHome, LIGHTCODE_HOME: lightcodeHome, MOCK_LLM_API_KEY: 'e2e' })
  // Electron's log folder ignores --user-data-dir: ~/Library/Logs/<product>.
  const logs = join(homedir(), 'Library', 'Logs', basename(app, '.app'))
  const logsExisted = existsSync(logs)
  const child = spawn(executable, [`--user-data-dir=${userData}`, '--remote-debugging-port=0'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  let browser
  let page
  const shot = name => page?.screenshot({ path: join(shots, `${name}.png`) })
  try {
    // Chromium writes the port it chose to DevToolsActivePort in the user data directory.
    const portFile = join(userData, 'DevToolsActivePort')
    await until(() => existsSync(portFile) || child.exitCode !== null, 'the Desktop app to start', 120_000)
    if (child.exitCode !== null) throw new Error(`Desktop exited with ${child.exitCode}`)
    const port = readFileSync(portFile, 'utf8').split('\n')[0]
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const appPage = () => browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('dsh-app://app'))
    await until(() => appPage() !== undefined, 'the Desktop application window', 120_000)
    page = appPage()
    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.getByRole('button', { name: 'Plugins' }).first().waitFor({ timeout: 120_000 })
    await exercisePluginsPage({ page, label: 'desktop', profileDir: join(dshHome, 'profiles', 'desktop'), lightcodeHome, mock, shot, log, pageErrors })
    log(`desktop: screenshots in ${shots}`)
  } catch (error) {
    await shot('failure')?.catch(() => {})
    throw new Error(`${error.message}\nscreenshots: ${shots}\n--- Desktop output (tail)\n${output.slice(-3000)}`, { cause: error })
  } finally {
    await browser?.close().catch(() => {})
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      const exited = await Promise.race([new Promise(resolve => child.once('exit', () => resolve(true))), new Promise(resolve => setTimeout(() => resolve(false), 15_000))])
      if (!exited) child.kill('SIGKILL')
    }
    await mock.close()
    if (!logsExisted && existsSync(logs) && readdirSync(logs).length === 0) rmdirSync(logs)
  }
}
