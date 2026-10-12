import { literalCommand } from '../command.ts'
import { ProjectionBuilder, sourceLines } from '../projection-map.ts'
import type { EconomyFilter, FilterInput } from '../types.ts'

const HINTS = new Set([
  '  (use "git add <file>..." to update what will be committed)',
  '  (use "git restore <file>..." to discard changes in working directory)',
  '  (use "git restore --staged <file>..." to unstage)',
  '  (use "git add <file>..." to include in what will be committed)',
])

function projectMapped(input: FilterInput) {
  const argv = literalCommand(input.command)
  if (argv?.[0] !== 'git' || argv[1] !== 'status' || input.exitCode !== 0 || /[\u001b\0]/.test(input.stdout)) return undefined
  if (argv.some(arg => /^(?:--(?:short|porcelain|null)(?:=|$)|-[^-]*[sz])/.test(arg))) return undefined
  const lines = sourceLines(input.stdout)
  if (!/^(?:On branch .+|HEAD detached (?:at|from) .+)$/.test(lines[0]?.text ?? '')) return undefined
  const builder = new ProjectionBuilder(input.stdout)
  for (const line of lines) if (!HINTS.has(line.text)) builder.keep(line.start, line.end)
  return builder.finish()
}

/** Only four exact English usage hints. All paths, status, branch/conflict information remain verbatim. */
export const gitStatusFilter: EconomyFilter = {
  name: 'git-status', transformation: 'noise-removal', projectMapped,
  project: input => projectMapped(input)?.text,
}
