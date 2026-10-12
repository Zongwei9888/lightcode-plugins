import { inspectShell } from '../shell-inspection.ts'
import { literalCommand } from '../command.ts'
import type { EconomyFilter, FilterInput } from '../types.ts'
import { resemblesCustomTestReport } from './custom-test-report.ts'
import { previewPositiveRows } from './test-preview.ts'

/** Recognize test invocations, never infer arbitrary package scripts to be tests. */
function isTestCommand(command: string): boolean {
  if (!inspectShell(command)) return false
  // Only stderr merge and a final line-window pipeline, not arbitrary compounds.
  const base = command.replace(/\s+2>&1(?=\s|$)/g, '').replace(/\s*\|\s*(?:tail|head)\s+(?:-\d+|-n\s+\d+)\s*$/, '')
  const argv = literalCommand(base)
  if (!argv) return false
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(argv[0] ?? '')) return argv[1] === 'test' || argv[1] === 'run' && argv[2] === 'test'
  if (['vitest', 'jest', 'pytest'].includes(argv[0] ?? '')) return true
  return (argv[0] === 'node' && argv.includes('--test')) || argv[0] === 'cargo' && argv[1] === 'test'
}

/** Preview repetitive positive-status rows without inventing a success/failure total. */
function projectMapped(input: FilterInput) {
  if (!isTestCommand(input.command) || input.exitCode !== 0 || /[\u001b\0]|\r(?!\n)/.test(input.stdout)) return undefined
  // Counted custom reports belong to test-report, including malformed ones.
  // A generic preview must not bypass its completion/count/exit-code checks.
  if (resemblesCustomTestReport(input.stdout)) return undefined
  return previewPositiveRows(input.stdout)
}

export const testProgressFilter: EconomyFilter = {
  name: 'test-progress', transformation: 'preview', projectMapped,
  project: input => projectMapped(input)?.text,
}
