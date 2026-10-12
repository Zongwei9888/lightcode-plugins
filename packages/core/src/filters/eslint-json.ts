import { developerCommand } from '../command.ts'
import { compactJsonLayout } from '../json-layout.ts'
import type { MappedProjection } from '../projection-map.ts'
import type { EconomyFilter, FilterInput } from '../types.ts'

/** Remove JSON layout whitespace only; preserve keys, values, escapes and order verbatim. */
function projectMapped(input: FilterInput): MappedProjection | undefined {
  const argv = developerCommand(input.command)
  if (argv?.[0] !== 'eslint' || ![0, 1].includes(input.exitCode)) return undefined
  const formats = argv.flatMap((arg, index) => arg === '-f' || arg === '--format'
    ? [argv[index + 1]] : arg.startsWith('--format=') ? [arg.slice(9)] : [])
  if (formats.length !== 1 || formats[0] !== 'json') return undefined
  let report: unknown
  try { report = JSON.parse(input.stdout) } catch { return undefined }
  if (!Array.isArray(report) || !report.every(file => file !== null && typeof file === 'object'
    && typeof file.filePath === 'string' && Array.isArray(file.messages)
    && Number.isSafeInteger(file.errorCount) && file.errorCount >= 0
    && Number.isSafeInteger(file.warningCount) && file.warningCount >= 0)) return undefined
  return compactJsonLayout(input.stdout)
}

export const eslintJsonFilter: EconomyFilter = {
  name: 'eslint-json', transformation: 'lossless-formatting',
  project: input => projectMapped(input)?.text, projectMapped,
}
