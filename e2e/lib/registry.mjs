/**
 * A throwaway npm registry (verdaccio) that serves the freshly packed
 * TokenWise packages under their real names and proxies everything else to
 * the public registry, so `pi install npm:@tokenwise/pi` and DSH's
 * "Add plugin → @tokenwise/dsh" run exactly as they will after publishing.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'

const freePort = () => new Promise((resolve, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)) })
})

/**
 * @param {{ verdaccio: string, dir: string, upstream?: string }} options
 * @returns {Promise<{ url: string, npmrc: string, env: Record<string, string>, publish: (tarball: string) => void, stop: () => Promise<void> }>}
 */
export async function startRegistry({ verdaccio, dir, upstream = 'https://registry.npmjs.org/' }) {
  mkdirSync(join(dir, 'storage'), { recursive: true })
  const port = await freePort()
  const url = `http://127.0.0.1:${port}/`
  writeFileSync(join(dir, 'config.yaml'), `storage: ${join(dir, 'storage')}
auth:
  htpasswd:
    file: ${join(dir, 'htpasswd')}
    max_users: -1
uplinks:
  npmjs:
    url: ${upstream}
    timeout: 60s
packages:
  '@tokenwise/*':
    access: $all
    publish: $all
    unpublish: $all
  '**':
    access: $all
    publish: $authenticated
    proxy: npmjs
server:
  keepAliveTimeout: 60
log: { type: stdout, format: pretty, level: warn }
`)
  const npmrc = join(dir, 'npmrc')
  writeFileSync(npmrc, `registry=${url}\n//127.0.0.1:${port}/:_authToken=tokenwise-e2e\n`)
  const child = spawn(verdaccio, ['--config', join(dir, 'config.yaml'), '--listen', `127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  child.stdout.on('data', chunk => { log += chunk })
  child.stderr.on('data', chunk => { log += chunk })
  const deadline = Date.now() + 30_000
  for (;;) {
    try { if ((await fetch(`${url}-/ping`)).ok) break } catch { /* Not up yet. */ }
    if (Date.now() > deadline || child.exitCode !== null) throw new Error(`verdaccio did not start:\n${log}`)
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  const env = { npm_config_registry: url, npm_config_userconfig: npmrc, NPM_CONFIG_REGISTRY: url, NPM_CONFIG_USERCONFIG: npmrc }
  return {
    url, npmrc, env,
    publish: tarball => {
      const result = spawnSync('npm', ['publish', tarball, '--registry', url, '--tag', 'latest', '--access', 'public'],
        { encoding: 'utf8', env: { ...process.env, ...env } })
      if (result.status !== 0) throw new Error(`npm publish ${tarball} failed:\n${result.stdout}\n${result.stderr}`)
    },
    stop: () => new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', () => resolve()); child.kill('SIGTERM') }),
  }
}
