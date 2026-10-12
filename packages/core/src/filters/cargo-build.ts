import { literalCommand } from '../command.ts'
import { ProjectionBuilder, sourceLines } from '../projection-map.ts'
import type { EconomyFilter, FilterInput } from '../types.ts'

/** Remove Cargo's recognized dependency progress, never compiler diagnostics or unknown build-script output. */
function projectMapped(input: FilterInput) {
  const argv = literalCommand(input.command)
  if (argv?.[0] !== 'cargo' || !['build', 'check', 'clippy', 'install'].includes(argv[1] ?? '')
    || argv.some(arg => arg.startsWith('--message-format') || ['-v', '-vv', '--verbose'].includes(arg))
    || ![0, 101].includes(input.exitCode) || /[\u001b\0]|\r(?!\n)/.test(input.stdout)) return undefined
  const complete = /^\s+Finished .+ target\(s\) in .+$/m.test(input.stdout)
    || /^error: (?:could not compile|aborting due to)/m.test(input.stdout)
  if (!complete) return undefined
  const builder = new ProjectionBuilder(input.stdout)
  let removed = 0
  for (const line of sourceLines(input.stdout)) {
    if (/^\s+(?:Compiling|Checking|Downloading|Downloaded) [\w.-]+ v\d[^\r\n]*$/.test(line.text)) removed++
    else builder.keep(line.start, line.end)
  }
  if (removed === 0) return undefined
  builder.newline()
  builder.generate(`[${removed} Cargo dependency progress rows omitted]\n`, 'cargo-progress')
  return builder.finish()
}

export const cargoBuildFilter: EconomyFilter = {
  name: 'cargo-build', transformation: 'noise-removal', projectMapped,
  project: input => projectMapped(input)?.text,
}
