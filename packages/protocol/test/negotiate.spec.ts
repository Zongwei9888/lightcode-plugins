import { describe, expect, it } from 'vitest'
import { ECONOMY_SPEC, COMMAND_NORMALIZATION_SPEC, negotiate } from '../src/index.ts'
import type { Capability } from '../src/index.ts'

const base: Capability[] = ['journal', 'artifacts', 'tokens']

describe('negotiate', () => {
  it('prefers raw-preserving in-process projection', () => {
    const [economy] = negotiate([ECONOMY_SPEC], [...base, 'toolResults', 'toolResultsPreserveRaw', 'toolCalls'])
    expect(economy).toMatchObject({ mode: 'apply', reason: 'apply via toolResultsPreserveRaw' })
  })
  it('uses the command wrapper when the host can only rewrite calls', () => {
    const [economy] = negotiate([ECONOMY_SPEC], [...base, 'toolCalls', 'commandWrapper'])
    expect(economy).toMatchObject({ mode: 'apply', via: [...base, 'commandWrapper'] })
  })
  it('accepts every verified host profile', async () => {
    const { HOST_PROFILES } = await import('../src/index.ts')
    for (const host of ['pi', 'codex', 'dsh', 'shell']) {
      expect(negotiate([ECONOMY_SPEC], HOST_PROFILES[host]!.capabilities)[0]!.mode, host).toBe('apply')
    }
    expect(negotiate([COMMAND_NORMALIZATION_SPEC], HOST_PROFILES.shell!.capabilities)[0]!.mode).toBe('off')
  })
  it('falls back to observation and explains a missing capability', () => {
    expect(negotiate([ECONOMY_SPEC], [...base, 'sessions'])[0]).toMatchObject({ mode: 'observe' })
    expect(negotiate([ECONOMY_SPEC], ['journal', 'tokens'])[0]).toMatchObject({ mode: 'off', reason: 'host lacks artifacts' })
    expect(negotiate([COMMAND_NORMALIZATION_SPEC], ['journal'])[0]).toMatchObject({ mode: 'off', reason: 'apply needs toolCalls' })
  })
  it('lets configuration lower a mode but never raise it', () => {
    const all: Capability[] = [...base, 'toolResults']
    expect(negotiate([ECONOMY_SPEC], all, { economy: 'observe' })[0]).toMatchObject({ mode: 'observe', reason: 'limited to observe by configuration' })
    expect(negotiate([ECONOMY_SPEC], all, { economy: 'off' })[0]).toMatchObject({ mode: 'off', reason: 'disabled by configuration' })
    expect(negotiate([ECONOMY_SPEC], [...base, 'sessions'], { economy: 'apply' })[0]).toMatchObject({ mode: 'observe' })
  })
})
