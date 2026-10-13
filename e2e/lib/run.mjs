/** Process helpers for the end-to-end scenarios. */
import { spawn, spawnSync } from 'node:child_process'

/** Child environment: local services bypass any configured HTTP proxy. */
export function childEnv(extra) {
  const env = { ...process.env, ...extra }
  const local = '127.0.0.1,localhost'
  for (const key of ['NO_PROXY', 'no_proxy']) env[key] = env[key] ? `${env[key]},${local}` : local
  return env
}

/** Run to completion; throws with the output on a non-zero exit unless `allowFailure`. */
export function run(command, args, { cwd, env, allowFailure = false, input } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 })
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status ?? result.signal}\n--- stdout\n${result.stdout}\n--- stderr\n${result.stderr}`)
  }
  return result
}

/** Run asynchronously (the mock model lives in this process, so the host must not block it). */
export function runAsync(command, args, { cwd, env, timeoutMs = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${command} timed out\n${stderr}`)) }, timeoutMs)
    child.on('error', reject)
    child.on('close', status => { clearTimeout(timer); resolve({ status, stdout, stderr }) })
  })
}

export const hasCommand = name => spawnSync('sh', ['-c', `command -v ${name}`], { stdio: 'ignore' }).status === 0
