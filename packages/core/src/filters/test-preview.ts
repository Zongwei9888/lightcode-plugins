import { ProjectionBuilder, sourceLines } from '../projection-map.ts'

/** Shared preview rendering; callers own command/format/completion validation. */
export function previewPositiveRows(raw: string, positive = (text: string) => /^\s*[✓✔]\s+\S/.test(text)) {
  const lines = sourceLines(raw)
  const builder = new ProjectionBuilder(raw)
  let omitted = 0
  for (let i = 0; i < lines.length;) {
    const start = i
    while (i < lines.length && positive(lines[i]!.text)) i++
    const count = i - start
    if (count >= 6) {
      builder.keep(lines[start]!.start, lines[start]!.end)
      builder.generate(`[${count - 2} positive-status rows omitted]\n`, 'test-progress-preview')
      builder.keep(lines[i - 1]!.start, lines[i - 1]!.end)
      omitted += count - 2
    } else for (let j = start; j < i; j++) builder.keep(lines[j]!.start, lines[j]!.end)
    if (i < lines.length) { builder.keep(lines[i]!.start, lines[i]!.end); i++ }
  }
  if (omitted === 0) return undefined
  builder.newline()
  builder.generate('[repeated positive-status rows condensed; other output retained]\n', 'test-preview-warning')
  return builder.finish()
}
