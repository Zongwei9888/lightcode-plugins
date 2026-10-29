/**
 * DeepSeek Harness's own search tools (`grep`, `glob` from dsh-tool-fs-search).
 * Only their complete rendering of the structured value qualifies: a result the
 * host capped, spilled or another listener rewrote is never touched.
 */
import { nativeGrepSections, nativePathList } from '@tokenwise/core'
import type { NativeResult } from '@tokenwise/core'
import type { ContentBlock } from './host.ts'

export const NATIVE_TOOLS: ReadonlySet<string> = new Set(['grep', 'glob'])

export function nativeResult(name: string, value: unknown, content: readonly ContentBlock[]): NativeResult | undefined {
  const block = content.length === 1 ? content[0] as { type?: unknown; text?: unknown } : undefined
  if (block?.type !== 'text' || typeof block.text !== 'string') return undefined
  const rendered = block.text
  const record = value !== null && typeof value === 'object' ? value as { matches?: unknown; paths?: unknown } : undefined
  if (name === 'grep' && Array.isArray(record?.matches)) return { rendered, projection: nativeGrepSections(record.matches, rendered) }
  if (name === 'glob' && Array.isArray(record?.paths)) return { rendered, projection: nativePathList(record.paths, rendered) }
  return undefined
}
