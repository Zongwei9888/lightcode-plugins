import { literalCommand } from '../command.ts'
import { compactJsonLayout } from '../json-layout.ts'
import type { EconomyFilter, FilterInput } from '../types.ts'

function projectMapped(input: FilterInput) {
  let argv = literalCommand(input.command)
  if (argv?.[0] === 'uv' && argv[1] === 'run') argv = argv.slice(2)
  if (argv?.[0] !== 'ruff' || argv[1] !== 'check' || ![0, 1].includes(input.exitCode)) return undefined
  const formats = argv.flatMap((arg, i) => arg === '--output-format' ? [argv[i + 1]]
    : arg.startsWith('--output-format=') ? [arg.slice('--output-format='.length)] : [])
  if (formats.length !== 1 || formats[0] !== 'json') return undefined
  let report: unknown
  try { report = JSON.parse(input.stdout) } catch { return undefined }
  if (!Array.isArray(report) || !report.every(item => item !== null && typeof item === 'object'
    && typeof item.filename === 'string' && typeof item.message === 'string'
    && (typeof item.code === 'string' || item.code === null)
    && item.location !== null && typeof item.location === 'object'
    && Number.isSafeInteger(item.location.row) && item.location.row > 0
    && Number.isSafeInteger(item.location.column) && item.location.column > 0)) return undefined
  return compactJsonLayout(input.stdout)
}

/** Keep every finding and field, including fixes, source and future extension keys. */
export const ruffJsonFilter: EconomyFilter = {
  name: 'ruff-json', transformation: 'lossless-formatting', projectMapped,
  project: input => projectMapped(input)?.text,
}
