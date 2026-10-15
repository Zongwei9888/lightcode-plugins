import type { ToolResultEvent } from '@earendil-works/pi-coding-agent'
import { nativeGrepRecords, nativePathLines } from '@lightcode-ai/core'
import type { FilterCandidate, NativeResult } from '@lightcode-ai/core'

/**
 * pi's own search tools: `grep` prints `path:line: text` rows, `find` one path
 * per line, each followed by any limit notice. Both layouts keep every row,
 * path and notice in order.
 */
const LAYOUTS: Readonly<Record<string, (text: string) => FilterCandidate | undefined>> = { grep: nativeGrepRecords, find: nativePathLines }

export const NATIVE_TOOLS: ReadonlySet<string> = new Set(Object.keys(LAYOUTS))

export function nativeResult(event: ToolResultEvent): NativeResult | undefined {
  const layout = Object.hasOwn(LAYOUTS, event.toolName) ? LAYOUTS[event.toolName] : undefined
  if (!layout || event.isError || event.content.length !== 1 || event.content[0]!.type !== 'text') return undefined
  const rendered = (event.content[0] as { text: string }).text
  return { rendered, projection: layout(rendered) }
}
