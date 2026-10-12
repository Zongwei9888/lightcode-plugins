import { ProjectionBuilder } from './projection-map.ts'
import type { MappedProjection } from './projection-map.ts'

/** Caller validates the format. Never parse/stringify: retain duplicate keys and numeric spelling. */
export function compactJsonLayout(raw: string, preserveNewlines = false): MappedProjection {
  const builder = new ProjectionBuilder(raw)
  let inString = false
  let escaped = false
  let start = 0
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]!
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (/[ \t\r\n]/.test(ch) && !(preserveNewlines && /[\r\n]/.test(ch))) {
      builder.keep(start, i)
      start = i + 1
    }
  }
  builder.keep(start, raw.length)
  return builder.finish()
}
