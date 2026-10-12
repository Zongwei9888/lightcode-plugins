import { literalCommand } from './command.ts'

export type CommandRewriteRule = 'search-record-format' | 'git-diff-no-color' | 'pytest-no-color'

/**
 * Presentation-only changes that make output recognizable by the filters.
 * Never shorten patterns, paths, test selection or diagnostics.
 */
export function rewriteCommand(command: string): { command: string; rule: CommandRewriteRule } | undefined {
  const argv = literalCommand(command)
  if (argv === undefined) return
  // Do not use literalCommand's quiet-cd normalization for execution rewriting.
  const prefix = /^\s*(rg|grep|git\s+diff|pytest|python[23]?(?:\.\d+)*\s+-m\s+pytest)(?=\s|$)/.exec(command)
  if (prefix === null) return
  let flags: string
  let rule: CommandRewriteRule
  if (argv[0] === 'rg' || argv[0] === 'grep') {
    // A deliberately closed grammar: ordinary matching only, not count/list/JSON/context/replace.
    let hasPattern = false
    let optionsEnded = false
    let hasLine = false
    let hasFile = false
    for (const arg of argv.slice(1)) {
      if (!optionsEnded && arg === '--') { optionsEnded = true; continue }
      if (!optionsEnded && arg.startsWith('-')) {
        if (!/^-[niFwHx]+$/.test(arg)) return
        hasLine ||= arg.includes('n')
        hasFile ||= arg.includes('H')
      } else hasPattern = true
    }
    if (!hasPattern || (hasLine && hasFile)) return
    flags = `${hasLine ? '' : ' -n'}${hasFile ? '' : ' -H'}`
    rule = 'search-record-format'
  } else if (argv[0] === 'git') {
    if (argv[1] !== 'diff' || argv.some(arg => /^--(?:no-)?color(?:=|$)/.test(arg))) return
    flags = ' --no-color'
    rule = 'git-diff-no-color'
  } else {
    if (argv.some(arg => /^--color(?:=|$)/.test(arg))) return
    flags = ' --color=no'
    rule = 'pytest-no-color'
  }
  return { command: command.slice(0, prefix[0].length) + flags + command.slice(prefix[0].length), rule }
}
