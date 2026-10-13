import { describe, expect, it } from 'vitest'
import type { JournalRecord } from '@lightcode/protocol'
import { collectSubagents, recordSubagent } from '../src/index.ts'

function journal() {
  const records: JournalRecord[] = []
  const decision = (sessionId: string): JournalRecord => ({ schemaVersion: 1, type: 'economy/decision', time: '2026-10-13T00:00:00.000Z', host: 'h', sessionId,
    callId: null, tool: 'bash', command: 'x', exitCode: 0, delivery: 'in-process', streams: 'merged', mode: 'apply', outcome: 'passed', runtimeVersion: '1', policyHash: 'p' })
  return {
    records, decision: (sessionId: string) => records.push(decision(sessionId)),
    link: (parent: string, child: string) => recordSubagent({ append: record => records.push(record) }, 'h', parent, child, new Date(0)),
    read: (sessionId: string) => records.filter(record => record.sessionId === sessionId),
  }
}

describe('subagent lineage', () => {
  it('records the link under the parent session', () => {
    const j = journal()
    j.link('parent', 'child')
    expect(j.records).toEqual([{ schemaVersion: 1, type: 'session/subagent', time: '1970-01-01T00:00:00.000Z', host: 'h', sessionId: 'parent', childSessionId: 'child' }])
  })

  it('collects every descendant once, with their records, and survives cycles', () => {
    const j = journal()
    j.link('root', 'a'); j.link('root', 'b'); j.link('a', 'a1'); j.link('a', 'a1'); j.link('a1', 'root'); j.link('b', 'a')
    for (const id of ['root', 'a', 'b', 'a1']) j.decision(id)
    const found = collectSubagents(j.read, 'root')
    expect(found.sessions).toEqual(['a', 'b', 'a1'])
    expect(found.records.filter(record => record.type === 'economy/decision').map(record => record.sessionId)).toEqual(['a', 'b', 'a1'])
    expect(collectSubagents(j.read, 'unknown')).toEqual({ sessions: [], records: [] })
    expect(collectSubagents(j.read, 'root', 2).sessions).toEqual(['a', 'b'])
  })
})
