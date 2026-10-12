import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { sha256 } from '@lightcode/core'

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
