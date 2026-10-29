/**
 * Subagent lineage: a subagent runs in a session of its own, so a session's
 * report finds what its subagents saved through `session/subagent` records
 * kept under the session that started them.
 */
import type { JournalPort, JournalRecord, SubagentRecord } from '@tokenwise/protocol'

export function recordSubagent(journal: JournalPort, host: string, sessionId: string, childSessionId: string, now = new Date()): void {
  journal.append({ schemaVersion: 1, type: 'session/subagent', time: now.toISOString(), host, sessionId, childSessionId })
}

export interface Subagents {
  /** Sessions started under the root: its subagents, theirs, and so on. */
  readonly sessions: readonly string[]
  /** Those sessions' records. */
  readonly records: readonly JournalRecord[]
}

/** Walk `session/subagent` records down from `root`; `read` returns one session's records. */
export function collectSubagents(read: (sessionId: string) => readonly JournalRecord[], root: string, limit = 1024): Subagents {
  const seen = new Set([root])
  const sessions: string[] = []
  const records: JournalRecord[] = []
  const queue = [...children(read(root))]
  for (let next = queue.shift(); next !== undefined && sessions.length < limit; next = queue.shift()) {
    if (seen.has(next)) continue
    seen.add(next)
    sessions.push(next)
    const own = read(next)
    records.push(...own)
    queue.push(...children(own))
  }
  return { sessions, records }
}

const children = (records: readonly JournalRecord[]) => records
  .filter((record): record is SubagentRecord => record.type === 'session/subagent' && typeof (record as SubagentRecord).childSessionId === 'string')
  .map(record => record.childSessionId)
