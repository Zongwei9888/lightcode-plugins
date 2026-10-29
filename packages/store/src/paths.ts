import { lstatSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { sha256 } from '@lightcode-ai/core'

/** `$LIGHTCODE_HOME`, else `~/.lightcode`. Everything LightCode writes stays under it. */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.LIGHTCODE_HOME?.trim()
  return configured ? resolve(configured) : join(homedir(), '.lightcode')
}

/** Private directory: original outputs can contain secrets printed by commands. */
export function ensurePrivateDir(path: string): string {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  return path
}

/** A host or session identifier as one safe path segment; unusual IDs are hashed. */
export function pathSegment(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) ? value : `h-${sha256(value).slice(0, 32)}`
}

/**
 * Second location for hosts that sandbox shell commands (Codex workspace-write
 * allows `$TMPDIR` but not `~/.lightcode`): a per-user directory in TMPDIR.
 * A `$LIGHTCODE_HOME` gets its own, so a separate home (a test, a second
 * profile) never reads what sessions of another home kept there.
 */
export function fallbackDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.LIGHTCODE_HOME?.trim()
  const scope = configured ? `-${sha256(resolve(configured)).slice(0, 12)}` : ''
  return join(resolve(env.TMPDIR?.trim() || tmpdir()), `lightcode-${process.getuid?.() ?? 'user'}${scope}`)
}

/** Every location LightCode may have written to, primary first. Readers look in all of them. */
export function dataDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const primary = resolveDataDir(env)
  const fallback = fallbackDataDir(env)
  return fallback === primary ? [primary] : [primary, fallback]
}

/**
 * The first location that can actually be written (probed, since sandboxes
 * deny at write time) and is owned by this user. Undefined: nowhere to keep
 * originals, so nothing may be filtered.
 */
export function writableDataDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const dir of dataDirs(env)) {
    try {
      ensurePrivateDir(dir)
      const stat = lstatSync(dir)
      if (!stat.isDirectory() || (process.getuid && stat.uid !== process.getuid())) continue
      const probe = join(dir, `.probe-${process.pid}`)
      writeFileSync(probe, '', { mode: 0o600 })
      rmSync(probe, { force: true })
      return dir
    } catch { /* Try the next location. */ }
  }
  return undefined
}
