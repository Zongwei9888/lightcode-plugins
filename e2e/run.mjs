#!/usr/bin/env node
/**
 * End-to-end suite: pack the distributable packages, serve them from a local
 * registry under their real names, install them into published pi and
 * DeepSeek Harness releases through each host's own plugin commands, and run
 * real sessions against a scripted model.
 *
 *   pnpm build && node e2e/run.mjs [dsh] [pi] [shadow] [evolve] [pi-tui] [web] [desktop]
 *
 * Hosts are cached in $TOKENWISE_E2E_CACHE (default: e2e/.cache); versions
 * come from TOKENWISE_E2E_DSH / TOKENWISE_E2E_PI (comma-separated). Nothing
 * touches ~/.dsh, ~/.pi, ~/.tokenwise or global npm/pnpm state.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runDesktop } from './desktop.mjs'
import { runDsh } from './dsh.mjs'
import { runEvolve } from './evolve.mjs'
import { ensureTool, VERSIONS } from './lib/hosts.mjs'
import { startRegistry } from './lib/registry.mjs'
import { run } from './lib/run.mjs'
import { runPi } from './pi.mjs'
import { runPiTui } from './pi-tui.mjs'
import { runShadow } from './shadow.mjs'
import { runWeb } from './web.mjs'

const repo = fileURLToPath(new URL('..', import.meta.url))
const cache = resolve(process.env.TOKENWISE_E2E_CACHE ?? join(repo, 'e2e', '.cache'))
const selected = process.argv.slice(2)
const wants = host => selected.length === 0 || selected.includes(host)
mkdirSync(cache, { recursive: true })
for (const host of ['dsh', 'pi']) {
  if (VERSIONS[host].length === 0) throw new Error(`no ${host} versions to test: TOKENWISE_E2E_${host.toUpperCase()} is empty`)
}
const root = mkdtempSync(join(process.env.TOKENWISE_E2E_TMP ?? tmpdir(), 'tokenwise-e2e-'))
const log = line => process.stdout.write(`${line}\n`)

const packs = join(root, 'packs')
mkdirSync(packs)
for (const dir of ['adapters/dsh', 'adapters/pi', 'packages/cli']) {
  run('pnpm', ['pack', '--pack-destination', packs], { cwd: join(repo, dir) })
}
const registry = await startRegistry({ verdaccio: join(ensureTool(cache, 'verdaccio', VERSIONS.verdaccio), 'verdaccio'), dir: join(root, 'registry') })
let failed = false
try {
  for (const tarball of readdirSync(packs)) registry.publish(join(packs, tarball))
  log(`registry ${registry.url} serves ${readdirSync(packs).join(', ')}`)
  if (wants('dsh')) await runDsh({ cache, root, registry, log })
  if (wants('pi')) await runPi({ cache, root, registry, log, checkout: join(repo, 'adapters', 'pi') })
  if (wants('shadow')) await runShadow({ cache, root, registry, log, hosts: ['dsh', 'pi'] })
  if (wants('evolve')) await runEvolve({ cache, root, registry, log })
  if (wants('pi-tui')) await runPiTui({ cache, root, registry, log })
  if (wants('web')) await runWeb({ cache, root, registry, log })
  if (wants('desktop')) await runDesktop({ cache, root, registry, log })
  log('e2e: all scenarios passed')
} catch (error) {
  failed = true
  log(`e2e: FAILED\n${error.stack ?? error}`)
  log(`work directory kept for inspection: ${root}`)
} finally {
  await registry.stop()
}
if (!failed && !process.env.TOKENWISE_E2E_KEEP) rmSync(root, { recursive: true, force: true })
process.exitCode = failed ? 1 : 0
