import { inspectShell } from '../shell-inspection.ts'
import { ProjectionBuilder, sourceLines } from '../projection-map.ts'
import type { EconomyFilter, FilterInput } from '../types.ts'

const RECORD = /^([^:\r\n\0]+):([1-9]\d*):/

/**
 * Group consecutive filename:line:text records, including those inside mixed
 * shell output. All matches, line numbers and non-record text remain in order.
 * No assumption that the last pipeline command owns the complete stdout.
 */
function projectMapped(input: FilterInput) {
  const shell = inspectShell(input.command)
  if (!shell?.heads.some(head => ['grep', 'rg', 'ripgrep'].includes(head))
    || ![0, 1].includes(input.exitCode) || /[\u001b\0]|\r(?!\n)/.test(input.stdout)) return undefined
  const lines = sourceLines(input.stdout)
  const builder = new ProjectionBuilder(input.stdout)
  let grouped = false
  for (let i = 0; i < lines.length;) {
    const first = lines[i]!
    const file = RECORD.exec(first.text)?.[1]
    let end = i + 1
    if (file !== undefined) while (end < lines.length && RECORD.exec(lines[end]!.text)?.[1] === file) end++
    if (file === undefined || end - i < 3 || file.length < 4) {
      builder.keep(first.start, first.end); i++; continue
    }
    builder.generate('[matches in ', 'search-layout')
    builder.keep(first.start, first.start + file.length)
    builder.generate('; every match retained]\n', 'search-layout')
    for (; i < end; i++) {
      const line = lines[i]!
      builder.generate('  ', 'search-layout')
      builder.keep(line.start + file.length + 1, line.end)
    }
    grouped = true
  }
  return grouped ? builder.finish() : undefined
}

export const searchLayoutFilter: EconomyFilter = {
  name: 'search-layout', transformation: 'lossless-formatting', projectMapped,
  project: input => projectMapped(input)?.text,
}
