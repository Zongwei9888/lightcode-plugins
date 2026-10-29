import { literalCommand, toolArgv } from '../command.ts'
import { ProjectionBuilder, sourceLines } from '../projection-map.ts'
import type { EconomyFilter } from '../types.ts'
import type { EconomyFilterName } from '../filter-names.ts'
import { economyRuleDisplayName } from '../filter-names.ts'
import { RTK_BUILTINS } from './builtins.ts'
import { compileRtkRule } from './engine.ts'

// Upstream's pinned gradle matcher expands to "gradlegradlew?" for the normal
// executable. Keep imported data intact and record the adapter correction here.
const compiled = RTK_BUILTINS.map(rule => compileRtkRule(rule.id === 'rtk/gradle'
  ? { ...rule, match_command: '^(?:gradle|gradlew|\\./gradlew)(?:\\s|$)' } : rule))

/**
 * The ways a rule may see a command: as written, and with the program named by
 * its file name (`/usr/local/bin/terraform plan` reads as `terraform plan`).
 */
function spellings(command: string): string[] {
  const written = literalCommand(command)?.join(' ')
  const tool = toolArgv(command)?.join(' ')
  return [...new Set([written, tool].filter((item): item is string => item !== undefined))]
}

/** Distinguish command coverage from unsupported output or syntax. */
export function matchesRtkCommand(command: string): boolean {
  const forms = [command, ...spellings(command)]
  return compiled.some(filter => forms.some(form => filter.matches(form)))
}

/** Output-only adapters; execution and status stay with the host, the original stays in the private store. */
export const RTK_FILTERS: readonly EconomyFilter[] = compiled.map(filter => {
  const projectMapped: EconomyFilter['projectMapped'] = input => {
    const forms = spellings(input.command)
    // Upstream shortcuts/caps are previews, not a proof of failure-diagnostic safety.
    // Preserve failed commands and partial/massive control-bearing reports intact.
    if (!forms.some(form => filter.matches(form)) || input.exitCode !== 0
      || input.stdout.length > 1_048_576 || /\0|\r(?!\n)/.test(input.stdout)
      || input.stdout.split('\n').some(line => line.length > 16384)) return undefined
    const candidate = filter.project(input.stdout)
    if (candidate.text === input.stdout || candidate.text === input.stdout.replace(/\r?\n$/, '')
      || candidate.text.trim() === '') return undefined
    // Exit 0 alone does not prove the absence of warnings/failure diagnostics.
    // A shortcut, whitelist or cap that removes such a row must not rely on
    // a later archive read to repair the observation. Reject the whole candidate.
    const retainedLines = new Set(sourceLines(candidate.text).map(line => line.text.trim()))
    for (const line of sourceLines(input.stdout)) {
      if (/\b(?:error|errors|warning|warnings|failed|failure|fatal|panic|traceback)\b/i.test(line.text)
        && !retainedLines.has(line.text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim())) return undefined
    }
    const builder = new ProjectionBuilder(input.stdout)
    builder.append(candidate)
    builder.newline()
    builder.generate(`[TokenWise ${economyRuleDisplayName(filter.rule.id as EconomyFilterName)} filtered output]\n`, 'rtk-preview-warning')
    return builder.finish()
  }
  return {
    name: filter.rule.id as EconomyFilterName, transformation: 'preview', projectMapped,
    project: input => projectMapped(input)?.text,
  }
})
