import { formatTokens, summarizeEconomy } from '@lightcode/mechanisms'
import type { EconomySummary } from '@lightcode/mechanisms'
import { cliContext } from './context.ts'

export function formatSummary(summary: EconomySummary, scope: string): string {
  const lines = [`LightCode Economy — ${scope}`]
  if (summary.decisions === 0 && summary.rewrites === 0) return `${lines[0]}\nNo recorded decisions yet.\n`
  const percent = summary.rawTokens ? ` (${Math.round(100 * summary.savedTokens / summary.rawTokens)}% of filtered outputs)` : ''
  lines.push(`  tool outputs seen     ${summary.decisions}`)
  lines.push(`  projected             ${summary.projected}`)
  if (summary.previewed) lines.push(`  previewed (observe)   ${summary.previewed}, would save ~${formatTokens(summary.previewSavedTokens)} tokens`)
  lines.push(`  passed unchanged      ${summary.passed}`)
  if (summary.failedOpen) lines.push(`  failed open           ${summary.failedOpen}`)
  lines.push(`  tokens saved          ~${formatTokens(summary.savedTokens)}${percent}`)
  if (summary.rewrites) lines.push(`  command rewrites      ${summary.rewrites}`)
  if (summary.byFilter.length) {
    lines.push('', '  by filter')
    for (const item of summary.byFilter.slice(0, 12)) lines.push(`    ${item.filter.padEnd(22)} ${String(item.count).padStart(5)}  ~${formatTokens(item.savedTokens)} tokens`)
  }
  if (summary.uncovered.length) {
    lines.push('', '  most frequent uncovered commands')
    for (const item of summary.uncovered.slice(0, 8)) lines.push(`    ${item.command.slice(0, 22).padEnd(22)} ${String(item.count).padStart(5)}  ~${formatTokens(item.rawTokens)} tokens`)
  }
  return lines.join('\n') + '\n'
}

export function report(options: { host?: string; session?: string; json?: boolean }): number {
  const context = cliContext()
  const records = context.journal.read({ ...options.host === undefined ? {} : { host: options.host },
    ...options.session === undefined ? {} : { sessionId: options.session } })
  const summary = summarizeEconomy(records)
  const scope = [options.host ?? 'all hosts', options.session ? `session ${options.session}` : 'all sessions'].join(', ')
  process.stdout.write(options.json ? JSON.stringify(summary, null, 2) + '\n' : formatSummary(summary, scope))
  return 0
}
