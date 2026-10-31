/**
 * Whether the user's own Claude Code permission rules already allow a Bash
 * command, so wrapping it in `tokenwise run` (and answering `allow` for the
 * wrapped form) grants nothing the user had not granted.
 *
 * Claude Code checks permission rules against the command it is about to run.
 * A wrapped command would no longer match the user's rules, so outside
 * bypassPermissions mode TokenWise wraps only when the original command is one
 * simple command that an allow rule matches and no deny or ask rule could
 * match. Anything else (a compound command, a rule this module cannot read, a
 * command allowed only by --allowedTools, which hooks cannot see) is left to
 * Claude Code as it is. RTK handles the same problem by reimplementing each
 * agent's permission checks; this is the narrow, conservative part of that.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

interface Rules { readonly allow: string[]; readonly deny: string[]; readonly ask: string[] }

/** Settings files whose rules apply to a session in `project` (managed settings first). */
export function settingsFiles(project: string | undefined, env: NodeJS.ProcessEnv = process.env): string[] {
  const user = env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), '.claude')
  const managed = process.platform === 'darwin' ? '/Library/Application Support/ClaudeCode/managed-settings.json'
    : process.platform === 'win32' ? 'C:\\Program Files\\ClaudeCode\\managed-settings.json' : '/etc/claude-code/managed-settings.json'
  return [managed, join(user, 'settings.json'), join(user, 'settings.local.json'),
    ...project ? [join(project, '.claude', 'settings.json'), join(project, '.claude', 'settings.local.json')] : []]
}

/** Rules from every readable file; undefined when a file exists but cannot be read as settings. */
export function loadRules(files: readonly string[]): Rules | undefined {
  const rules: Rules = { allow: [], deny: [], ask: [] }
  for (const file of files) {
    let text: string
    try { text = readFileSync(file, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      return undefined
    }
    let permissions: unknown
    try { permissions = (JSON.parse(text) as { permissions?: unknown }).permissions } catch { return undefined }
    if (permissions === undefined) continue
    if (typeof permissions !== 'object' || permissions === null) return undefined
    for (const kind of ['allow', 'deny', 'ask'] as const) {
      const list = (permissions as Record<string, unknown>)[kind]
      if (list === undefined) continue
      if (!Array.isArray(list) || !list.every(item => typeof item === 'string')) return undefined
      rules[kind].push(...list)
    }
  }
  return rules
}

/**
 * A command Claude Code runs as one command: no operators, substitutions,
 * redirections or line breaks, except a trailing `2>&1`, which only merges
 * the error stream into the output (agents add it to most test runs).
 */
export function simpleCommand(command: string): boolean {
  const body = command.replace(/\s+2>&1\s*$/u, '')
  return body.trim() !== '' && !/[;&|<>`\n\r]|\$\(/u.test(body)
}

/**
 * Whether a rule applies to a simple command: `Bash`, `Bash(*)`, `Bash(exact)`,
 * `Bash(prefix:*)` and `Bash(glob with *)`. `undefined` for a Bash rule whose
 * pattern this module does not understand. `loose` (for deny and ask rules)
 * errs toward a match: a prefix matches without a word boundary, an exact
 * pattern as a prefix.
 */
export function ruleMatches(rule: string, command: string, loose = false): boolean | undefined {
  const text = rule.trim()
  if (text === 'Bash') return true
  const match = /^Bash\((.*)\)$/su.exec(text)
  if (!match) return /^Bash\b/u.test(text) ? undefined : false
  const pattern = match[1]!.trim()
  const cmd = command.trim()
  if (pattern === '') return undefined
  if (pattern === '*') return true
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -2)
    if (prefix.includes('*')) return undefined
    return loose ? cmd.startsWith(prefix) : cmd === prefix || cmd.startsWith(`${prefix} `)
  }
  if (!pattern.includes('*')) return loose ? cmd.startsWith(pattern) : cmd === pattern
  const regex = new RegExp(`^${pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/gu, '\\$&')).join('.*')}$`, 'su')
  return regex.test(cmd)
}

/** True only when the user's rules allow `command` outright and nothing could deny it or ask about it. */
export function allowedByRules(command: string, project: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!simpleCommand(command)) return false
  const rules = loadRules(settingsFiles(project, env))
  if (!rules) return false
  // Deny and ask rules are checked with and without a trailing `2>&1`; a rule that might match (an unreadable pattern included) blocks the wrap.
  const forms = [command, command.replace(/\s+2>&1\s*$/u, '')]
  for (const rule of [...rules.deny, ...rules.ask]) if (forms.some(form => ruleMatches(rule, form, true) !== false)) return false
  // An allow rule must match the command exactly as written.
  return rules.allow.some(rule => ruleMatches(rule, command) === true)
}
