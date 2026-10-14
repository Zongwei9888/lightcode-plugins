import { describe, expect, it } from 'vitest'
import { sha256 } from '@lightcode/core'
import type { ArtifactPort, ArtifactRef, ShadowReference } from '@lightcode/protocol'
import {
  boundedExcerpt, checkpointAdmitted, checkpointRecord, cutNote, externalizeCut, parseCheckpoint, planShadow, recallObservation,
  referenceIndex, renderCheckpoint, renderRecall,
} from '../src/index.ts'
import type { ShadowMessage } from '../src/index.ts'

class MemoryArtifacts implements ArtifactPort {
  readonly items = new Map<string, string>()
  corrupt = false
  save(text: string): ArtifactRef {
    this.items.set(sha256(text), this.corrupt ? `${text}!` : text)
    return { sha256: sha256(text), bytes: Buffer.byteLength(text) }
  }
  read(hash: string) { return this.items.get(hash) }
}

const log = (n: number, tag = 'line') => Array.from({ length: n }, (_, i) => `${tag} ${i}: value ${i * 7}`).join('\n') + "\nE   KeyError: 'retry_backoff'"
const segment = (big: string): ShadowMessage[] => [
  { role: 'user', text: 'Fix the KeyError. Do not change the public API.' },
  { role: 'assistant', text: 'Running the tests.' },
  { role: 'tool', text: big, toolName: 'bash', callId: 'c1' },
  { role: 'tool', text: 'ok', toolName: 'bash', callId: 'c2' },
  { role: 'user', text: 'Also keep "retry" spelled that way.\nThanks' },
]

describe('LightShadow plan', () => {
  it('externalizes verified tool results, keeps small ones and the user messages exactly', () => {
    const artifacts = new MemoryArtifacts()
    const big = log(300)
    const plan = planShadow(segment(big), { artifacts })
    expect(plan.references).toHaveLength(1)
    const [reference] = plan.references
    expect(reference).toMatchObject({ id: `o-${sha256(big).slice(0, 12)}`, sha256: sha256(big), tool: 'bash', callId: 'c1' })
    expect(Buffer.byteLength(reference!.excerpt)).toBeLessThanOrEqual(320)
    expect(reference!.excerpt).toContain("KeyError: 'retry_backoff'")
    expect(plan.residual[2]!.text).toContain(`observation_id: ${reference!.id}`)
    expect(plan.residual[3]!.text).toBe('ok')
    expect(plan.contract).toEqual(['Fix the KeyError. Do not change the public API.', 'Also keep "retry" spelled that way.\nThanks'])
    expect(artifacts.read(reference!.sha256)).toBe(big)
  })

  it('leaves a result in place when the stored copy does not read back', () => {
    const artifacts = new MemoryArtifacts()
    artifacts.corrupt = true
    const plan = planShadow(segment(log(300)), { artifacts })
    expect(plan.references).toEqual([])
    expect(plan.residual[2]!.text).toBe(log(300))
  })

  it('names the original of a result Economy shortened', () => {
    const artifacts = new MemoryArtifacts()
    const plan = planShadow(segment(log(300)), { artifacts, originalOf: id => id === 'c1' ? { sha256: 'a'.repeat(64), bytes: 99_999 } : undefined })
    expect(plan.references[0]!.original).toEqual({ sha256: 'a'.repeat(64), bytes: 99_999 })
    expect(renderCheckpoint('s', plan)).toContain('original: 99999 bytes')
  })

  it('round-trips a checkpoint and carries its references and user messages into the next one', () => {
    const artifacts = new MemoryArtifacts()
    const first = planShadow(segment(log(300)), { artifacts })
    const text = renderCheckpoint('We were fixing retry_backoff.', first)
    const parsed = parseCheckpoint(`Preamble from the host\n<compacted-summary>\n${text}\n</compacted-summary>`)
    expect(parsed.contract).toEqual(first.contract)
    expect(parsed.ids).toEqual(first.references.map(ref => ref.id))
    expect(parsed.summary).toContain('We were fixing retry_backoff.')
    expect(parsed.summary).not.toContain('observation_id')
    expect(parsed.summary).not.toContain('Do not change the public API')

    const known = referenceIndex([checkpointRecord({ host: 'h', sessionId: 's', time: 't' }, { kind: 'lightshadow', plan: first, checkpointTokens: 1 })])
    const later = planShadow([
      { role: 'summary', text },
      { role: 'user', text: 'Now run the linter.' },
      { role: 'tool', text: log(200, 'lint'), toolName: 'bash', callId: 'c9' },
    ], { artifacts, knownReference: id => known.get(id) })
    expect(later.references.map(ref => ref.id)).toEqual([...first.references.map(ref => ref.id), `o-${sha256(log(200, 'lint')).slice(0, 12)}`])
    expect(later.contract).toEqual([...first.contract, 'Now run the linter.'])
    expect(later.residual[0]!.text).toBe('We were fixing retry_backoff.')

    // pi passes the previous checkpoint apart from the segment.
    const viaPrior = planShadow([{ role: 'user', text: 'next' }], { artifacts, knownReference: id => known.get(id), prior: text })
    expect(viaPrior.contract).toEqual([...first.contract, 'next'])
    expect(viaPrior.references.map(ref => ref.id)).toEqual(first.references.map(ref => ref.id))
  })

  it('bounds the exact user messages, keeping the first and the latest', () => {
    const users: ShadowMessage[] = Array.from({ length: 10 }, (_, i) => ({ role: 'user', text: `${i}`.repeat(100) }))
    const plan = planShadow(users, { artifacts: new MemoryArtifacts(), maxContractBytes: 350 })
    expect(plan.contract.map(text => text[0])).toEqual(['0', '8', '9'])
    expect(plan.contractOmitted).toBe(7)
    expect(renderCheckpoint('s', plan)).toContain('(7 earlier user messages summarized above)')
    expect(parseCheckpoint(renderCheckpoint('s', plan)).contract).toHaveLength(3)
  })

  it('admits a checkpoint only when it is smaller than the segment', () => {
    const artifacts = new MemoryArtifacts()
    const plan = planShadow(segment(log(300)), { artifacts })
    expect(checkpointAdmitted(renderCheckpoint('short', plan), plan)).toBe(true)
    expect(checkpointAdmitted('x'.repeat(plan.segmentTokens * 4), plan)).toBe(false)
  })

  it('bounds excerpts in bytes without splitting characters', () => {
    const text = `${'中'.repeat(400)}\nmiddle\n${'文'.repeat(400)}`
    const excerpt = boundedExcerpt(text, 100)
    expect(Buffer.byteLength(excerpt)).toBeLessThanOrEqual(100)
    expect(excerpt).not.toContain('�')
  })
})

describe('recall', () => {
  const setup = () => {
    const artifacts = new MemoryArtifacts()
    const big = log(2000)
    const plan = planShadow(segment(big), { artifacts, originalOf: () => artifacts.save(`${big}\nmore original`) })
    const index = referenceIndex([checkpointRecord({ host: 'h', sessionId: 's', time: 't' }, { kind: 'lightshadow', plan, checkpointTokens: 1 })])
    return { artifacts, big, reference: plan.references[0]!, lookup: (id: string) => index.get(id) }
  }

  it('returns small results whole and a bounded window of a large one around the query', () => {
    const { artifacts, big, reference, lookup } = setup()
    expect(recallObservation({ observation_id: reference.id }, { lookup, artifacts })).toMatchObject({ ok: false, error: expect.stringMatching(/pass a query/) })
    const window = recallObservation({ observation_id: reference.id, query: 'line 1000:' }, { lookup, artifacts })
    expect(window.ok).toBe(true)
    if (!window.ok) return
    expect(window.text).toContain('line 1000: value 7000')
    expect(Buffer.byteLength(window.text)).toBeLessThanOrEqual(8192)
    expect(big).toContain(window.text)
    expect(renderRecall(reference.id, window)).toMatch(/^\[o-[a-f0-9]{12}: lines \d+-\d+ of 2001\]/)
    const whole = recallObservation({ observation_id: reference.id, query: 'KeyError' }, { lookup, artifacts, windowBytes: 1_000_000 })
    expect(whole).toEqual({ ok: true, text: big, complete: true })
  })

  it('reads the original Economy shortened, and refuses unknown or expired references', () => {
    const { artifacts, reference, lookup } = setup()
    const original = recallObservation({ observation_id: reference.id, query: 'more original', original: true }, { lookup, artifacts })
    expect(original).toMatchObject({ ok: true, text: expect.stringContaining('more original') })
    expect(recallObservation({ observation_id: 'o-000000000000' }, { lookup, artifacts })).toMatchObject({ ok: false, error: expect.stringMatching(/unknown/) })
    expect(recallObservation({}, { lookup, artifacts })).toMatchObject({ ok: false })
    expect(recallObservation({ observation_id: reference.id, query: 'not there at all' }, { lookup, artifacts })).toMatchObject({ ok: false, error: expect.stringMatching(/does not occur/) })
    artifacts.items.clear()
    expect(recallObservation({ observation_id: reference.id, query: 'x' }, { lookup, artifacts })).toMatchObject({ ok: false, error: expect.stringMatching(/no longer stored/) })
  })

  it('clips a single line longer than the window', () => {
    const artifacts = new MemoryArtifacts()
    const line = `needle ${'x'.repeat(20_000)}`
    const reference = externalizeCut(line, { artifacts, tool: 'bash' })!
    const result = recallObservation({ observation_id: reference.id, query: 'needle' }, { lookup: () => reference, artifacts })
    expect(result).toMatchObject({ ok: true, complete: false, lines: [1, 1] })
    if (result.ok) expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(8192)
  })
})

describe('cut externalization', () => {
  it('keeps the complete text of a head/tail cut and names it in the note', () => {
    const artifacts = new MemoryArtifacts()
    const reference = externalizeCut(log(500), { artifacts, tool: 'bash', callId: 'c' }) as ShadowReference
    expect(artifacts.read(reference.sha256)).toBe(log(500))
    expect(cutNote(reference, 1234)).toContain(`observation_id ${reference.id}`)
    artifacts.corrupt = true
    expect(externalizeCut('other', { artifacts })).toBeUndefined()
  })
})
