/** Syntax inspection only. Never executes, expands, rewrites or splits tool execution. */
import { developerCommand, isCustomNodeTestCommand } from './command.ts'
export interface ShellInspection {
  readonly heads: readonly string[]
  readonly compound: boolean
}

/**
 * Extract command heads for lossless output formatting and diagnostics, not for
 * assigning a mixed stdout to a particular command. Expansions, substitutions,
 * control structures and heredocs have no supported interpretation here.
 */
export function inspectShell(command: string): ShellInspection | undefined {
  if (command.length > 65536 || /[\r\n\0]/.test(command)) return undefined
  const heads: string[] = []
  let word = ''
  let started = false
  let head: string | undefined
  let quote: string | undefined
  let compound = false
  const flush = () => {
    if (started && head === undefined) head = word
    word = ''; started = false
  }
  const segment = (): boolean => {
    flush()
    if (head === undefined || !/^\/?(?:[\w.+-]+\/)*[\w.+-]+$/.test(head)
      || ['if', 'then', 'else', 'fi', 'for', 'while', 'do', 'done', 'case', 'function', 'eval', 'source', '.'].includes(head)) return false
    heads.push(head.split('/').at(-1)!)
    head = undefined
    return true
  }
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!
    if (quote === "'") {
      if (ch === quote) quote = undefined
      else word += ch
      continue
    }
    if (ch === '\\') {
      const next = command[++i]
      if (next === undefined) return undefined
      word += next; started = true
      continue
    }
    if (ch === '$' || ch === '`') return undefined
    if (quote === '"') {
      if (ch === quote) quote = undefined
      else word += ch
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; started = true; continue }
    if (/\s/.test(ch)) { flush(); continue }
    if ('(){}#'.includes(ch) || command.slice(i, i + 2) === '<<') return undefined
    // Redirects may occur in inspected pipelines, but do not become heads.
    if (ch === '&' && command[i - 1] === '>') { word += ch; started = true; continue }
    if (';|&'.includes(ch)) {
      if (!segment()) return undefined
      if (command[i + 1] === ch && (ch === '&' || ch === '|')) i++
      else if (ch === '&') return undefined
      compound = true
      continue
    }
    word += ch; started = true
  }
  if (quote !== undefined || !segment()) return undefined
  return { heads, compound }
}

/** Command families actually implemented here; planned families must not count as covered. */
export function hasBuiltinCommand(command: string): boolean {
  const argv = developerCommand(command)
  if (!argv) return false
  const head = argv[0], sub = argv[1]
  if (['grep', 'rg', 'ripgrep', 'pytest', 'tsc', 'eslint', 'find', 'ls', 'vitest', 'jest'].includes(head ?? '')) return true
  if (head === 'git') return sub === 'diff' || sub === 'status'
  if (head === 'cargo') return ['test', 'build', 'check', 'clippy', 'install'].includes(sub ?? '')
  if (head === 'go') return sub === 'test'
  if (head === 'vite') return sub === 'build'
  if (head === 'ruff') return sub === 'check'
  if (head === 'node') return argv.includes('--test') || isCustomNodeTestCommand(argv)
  if (/^python\d*(?:\.\d+)*$/.test(head ?? '')) return sub === '-m' && argv[2] === 'pytest'
  if (head === 'uv') return sub === 'run' && argv[2] === 'ruff' && argv[3] === 'check'
  if (head === 'pnpm' && ['install', 'add', 'update', 'remove'].includes(sub ?? '')) return true
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(head ?? '')) return sub === 'test' || sub === 'run' && argv[2] === 'test'
  return false
}
