import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveFilterOptions } from '@lightcode/core'
import type { MechanismMode } from '@lightcode/protocol'

export interface EconomyConfig {
  /** Ceiling for negotiation: the host decides whether `apply` is possible. */
  readonly mode: MechanismMode
  /** A projection must save at least this many estimated tokens (minimum 1). */
  readonly minimumSavedTokens: number
  /** Bounded filter parameters; see `resolveFilterOptions`. */
  readonly filterOptions?: unknown
  readonly commandNormalization: boolean
}

export interface LightShadowConfig {
  /** Ceiling for negotiation, like Economy's. */
  readonly mode: MechanismMode
}

export interface LightCodeConfig {
  readonly economy: EconomyConfig
  readonly lightshadow: LightShadowConfig
  readonly artifacts: { readonly retentionDays: number }
}

export const DEFAULT_CONFIG: LightCodeConfig = Object.freeze({
  economy: Object.freeze({ mode: 'apply' as const, minimumSavedTokens: 16, commandNormalization: true }),
  lightshadow: Object.freeze({ mode: 'apply' as const }),
  artifacts: Object.freeze({ retentionDays: 14 }),
})

export interface LoadedConfig {
  readonly config: LightCodeConfig
  /** Files and variables that contributed, in precedence order. */
  readonly sources: readonly string[]
  /** Any problem turns Economy and LightShadow off: a broken configuration must not silently filter. */
  readonly problems: readonly string[]
}

const MODES = new Set(['off', 'observe', 'apply'])
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

function readJson(path: string): unknown {
  try { statSync(path) } catch { return undefined }
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

const RANK: Record<MechanismMode, number> = { off: 0, observe: 1, apply: 2 }

/** `lowerOnly` (a project's file): the mode may only go down, and command rewriting may only be switched off. */
function mergeEconomy(base: EconomyConfig, input: unknown, where: string, problems: string[], lowerOnly = false): EconomyConfig {
  if (input === undefined) return base
  if (!record(input)) { problems.push(`${where}: economy must be an object`); return base }
  let next = { ...base }
  for (const [key, value] of Object.entries(input)) {
    if (key === 'mode' && typeof value === 'string' && MODES.has(value)) {
      const mode = value as MechanismMode
      if (!lowerOnly || RANK[mode] <= RANK[next.mode]) next = { ...next, mode }
    } else if (key === 'commandNormalization' && typeof value === 'boolean' && lowerOnly) next = { ...next, commandNormalization: next.commandNormalization && value }
    else if (key === 'minimumSavedTokens' && Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 1_000_000) next = { ...next, minimumSavedTokens: value as number }
    else if (key === 'filterOptions' && resolveFilterOptions(value) !== undefined) next = { ...next, filterOptions: value }
    else if (key === 'commandNormalization' && typeof value === 'boolean') next = { ...next, commandNormalization: value }
    else problems.push(`${where}: invalid economy.${key}`)
  }
  return next
}

function mergeShadow(base: LightShadowConfig, input: unknown, where: string, problems: string[], lowerOnly = false): LightShadowConfig {
  if (input === undefined) return base
  if (!record(input)) { problems.push(`${where}: lightshadow must be an object`); return base }
  let next = { ...base }
  for (const [key, value] of Object.entries(input)) {
    if (key === 'mode' && typeof value === 'string' && MODES.has(value)) {
      const mode = value as MechanismMode
      if (!lowerOnly || RANK[mode] <= RANK[next.mode]) next = { ...next, mode }
    } else problems.push(`${where}: invalid lightshadow.${key}`)
  }
  return next
}

/**
 * User file `<data>/config.json`, then project file `<cwd>/.lightcode/config.json`
 * (Economy settings only, and it can only lower the mode or switch command
 * rewriting off, so a cloned repository can neither change retention nor
 * re-enable what the user turned off), then `LIGHTCODE_ECONOMY=apply|observe|off`,
 * `LIGHTCODE_LIGHTSHADOW=apply|observe|off` and `LIGHTCODE_DISABLE=1`.
 */
export function loadConfig(options: { dataDir: string; cwd?: string; env?: NodeJS.ProcessEnv }): LoadedConfig {
  const env = options.env ?? process.env
  const problems: string[] = []
  const sources: string[] = []
  let economy: EconomyConfig = DEFAULT_CONFIG.economy
  let lightshadow: LightShadowConfig = DEFAULT_CONFIG.lightshadow
  let retentionDays = DEFAULT_CONFIG.artifacts.retentionDays
  const files = [{ path: join(options.dataDir, 'config.json'), project: false },
    ...options.cwd === undefined ? [] : [{ path: join(options.cwd, '.lightcode', 'config.json'), project: true }]]
  for (const file of files) {
    let value: unknown
    try { value = readJson(file.path) } catch (error) { problems.push(`${file.path}: ${(error as Error).message}`); continue }
    if (value === undefined) continue
    sources.push(file.path)
    if (!record(value)) { problems.push(`${file.path}: expected a JSON object`); continue }
    for (const [key, section] of Object.entries(value)) {
      if (key === 'economy') economy = mergeEconomy(economy, section, file.path, problems, file.project)
      else if (key === 'lightshadow') lightshadow = mergeShadow(lightshadow, section, file.path, problems, file.project)
      else if (key === 'artifacts' && !file.project && record(section) && Object.keys(section).every(item => item === 'retentionDays')
        && Number.isSafeInteger(section.retentionDays) && (section.retentionDays as number) >= 1 && (section.retentionDays as number) <= 3650) {
        retentionDays = section.retentionDays as number
      } else if (key !== '$schema') problems.push(`${file.path}: unsupported setting ${key}`)
    }
  }
  const forced = env.LIGHTCODE_ECONOMY?.trim()
  if (forced) {
    sources.push('LIGHTCODE_ECONOMY')
    if (MODES.has(forced)) economy = { ...economy, mode: forced as MechanismMode }
    else problems.push(`LIGHTCODE_ECONOMY: expected apply, observe or off`)
  }
  const shadowForced = env.LIGHTCODE_LIGHTSHADOW?.trim()
  if (shadowForced) {
    sources.push('LIGHTCODE_LIGHTSHADOW')
    if (MODES.has(shadowForced)) lightshadow = { mode: shadowForced as MechanismMode }
    else problems.push(`LIGHTCODE_LIGHTSHADOW: expected apply, observe or off`)
  }
  if (env.LIGHTCODE_DISABLE === '1') {
    sources.push('LIGHTCODE_DISABLE')
    economy = { ...economy, mode: 'off' }
    lightshadow = { mode: 'off' }
  }
  if (problems.length) {
    economy = { ...economy, mode: 'off' }
    lightshadow = { mode: 'off' }
  }
  return { config: { economy, lightshadow, artifacts: { retentionDays } }, sources, problems }
}

/** Prune at most once a day; returns the number of removed originals, or undefined when skipped. */
export function collectDaily(dataDir: string, prune: (days: number) => number, retentionDays: number, now = Date.now()): number | undefined {
  const stamp = join(dataDir, '.gc-stamp')
  try { if (now - statSync(stamp).mtimeMs < 86_400_000) return undefined } catch { /* First run. */ }
  try { writeFileSync(stamp, new Date(now).toISOString() + '\n', { mode: 0o600 }) } catch { return undefined }
  return prune(retentionDays)
}
