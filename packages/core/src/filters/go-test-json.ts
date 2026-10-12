import { literalCommand } from '../command.ts'
import { compactJsonLayout } from '../json-layout.ts'
import type { EconomyFilter, FilterInput } from '../types.ts'

const ACTIONS = new Set(['start', 'run', 'pause', 'cont', 'pass', 'bench', 'fail', 'output', 'skip'])

function projectMapped(input: FilterInput) {
  const argv = literalCommand(input.command)
  if (argv?.[0] !== 'go' || argv[1] !== 'test' || !argv.includes('-json') || ![0, 1].includes(input.exitCode)) return undefined
  const lines = input.stdout.split(/\r?\n/).filter(line => line.trim() !== '')
  if (lines.length === 0) return undefined
  try {
    for (const line of lines) {
      const event: unknown = JSON.parse(line)
      if (event === null || typeof event !== 'object' || Array.isArray(event)) return undefined
      const value = event as Record<string, unknown>
      if (typeof value.Action !== 'string' || !ACTIONS.has(value.Action) || typeof value.Package !== 'string') return undefined
    }
  } catch { return undefined }
  return compactJsonLayout(input.stdout, true)
}

/** Layout only. Preserve ALL test events and escaped Output bytes; never select passing tests away. */
export const goTestJsonFilter: EconomyFilter = {
  name: 'go-test-json', transformation: 'lossless-formatting', projectMapped,
  project: input => projectMapped(input)?.text,
}
