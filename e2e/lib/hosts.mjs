/**
 * Published hosts and tools, installed once per version into a cache
 * directory (never into the user's global prefix, DSH_HOME or pi agent dir).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const VERSIONS = {
  dsh: (process.env.LIGHTCODE_E2E_DSH ?? '0.2.0-rc.2,0.2.1-alpha.2').split(',').filter(Boolean),
  pi: (process.env.LIGHTCODE_E2E_PI ?? '1.1.0,1.2.0').split(',').filter(Boolean),
  // DeepSeek Harness 0.2 drives the pnpm on PATH for `dsh plugin`; it needs pnpm 11 or later.
  pnpm: process.env.LIGHTCODE_E2E_PNPM ?? '11.28.5',
  verdaccio: '6.10.4',
  playwright: '1.63.0',
}

const PACKAGES = { dsh: '@deepseek-ai/dsh', pi: '@earendil-works/pi-coding-agent', pnpm: 'pnpm', verdaccio: 'verdaccio' }
const BINARIES = { dsh: 'dsh', pi: 'pi', pnpm: 'pnpm', verdaccio: 'verdaccio' }

/** @returns the absolute bin directory of `tool@version`, installing it on first use. */
export function ensureTool(cache, tool, version) {
  const prefix = join(cache, `${tool}-${version}`)
  const bin = join(prefix, 'bin')
  if (existsSync(join(bin, BINARIES[tool]))) return bin
  mkdirSync(prefix, { recursive: true })
  process.stdout.write(`installing ${PACKAGES[tool]}@${version} into ${prefix} …\n`)
  const result = spawnSync('npm', ['install', '--global', '--prefix', prefix, '--cache', join(cache, 'npm-cache'),
    '--no-fund', '--no-audit', `${PACKAGES[tool]}@${version}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.status !== 0) throw new Error(`installing ${PACKAGES[tool]}@${version} failed:\n${result.stderr}`)
  return bin
}

/** A library (not a CLI) installed into the cache; returns its directory for `import`. */
export function ensureLibrary(cache, name, version) {
  const prefix = join(cache, `${name.replace('/', '+')}-${version}`)
  const dir = join(prefix, 'node_modules', name)
  if (existsSync(join(dir, 'package.json'))) return dir
  mkdirSync(prefix, { recursive: true })
  process.stdout.write(`installing ${name}@${version} into ${prefix} …\n`)
  const result = spawnSync('npm', ['install', '--prefix', prefix, '--cache', join(cache, 'npm-cache'), '--no-fund', '--no-audit', `${name}@${version}`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.status !== 0) throw new Error(`installing ${name}@${version} failed:\n${result.stderr}`)
  return dir
}
