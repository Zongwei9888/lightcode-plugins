import { createPolicy, decideShellProjection, ECONOMY_RUNTIME_VERSION, estimateTokens as defaultEstimate, rewriteCommand, sha256 } from '@lightcode/core'
import type { EconomyPolicy, ShellResult, TokenEstimator } from '@lightcode/core'
import type { ArtifactPort, EconomyFailure, EconomyRecord, JournalPort, TextMeasure } from '@lightcode/protocol'
import type { EconomyConfig } from '@lightcode/store'

export interface EconomyEngineOptions {
  readonly host: string
  readonly journal: JournalPort
  readonly artifacts: ArtifactPort
  readonly config: EconomyConfig
  /** Negotiated mode; `observe` records what would change and delivers the original. */
  readonly mode: 'apply' | 'observe'
  readonly delivery: EconomyRecord['delivery']
  readonly streams: EconomyRecord['streams']
  readonly estimateTokens?: TokenEstimator
  readonly now?: () => Date
  /** Diagnostics only. Errors never reach the host's tool result. */
  readonly onError?: (error: unknown) => void
}

export interface EconomyRequest {
  readonly sessionId: string | null
  readonly callId: string | null
  readonly tool: string
  readonly result: ShellResult
}

export interface EconomyOutput {
  /** Defined only when the host should deliver this text instead of the original. */
  readonly text?: string
  readonly record?: EconomyRecord
}

/**
 * Token Economy over the journal and artifact ports. The original is saved and
 * the decision journaled before a projection is released; any failure on the
 * way delivers the original (fail-open).
 */
export class EconomyEngine {
  private readonly policies = new Map<string, EconomyPolicy>()
  private readonly options: EconomyEngineOptions
  constructor(options: EconomyEngineOptions) {
    this.options = options
  }

  /** One policy per session, captured at its first decision. */
  policyFor(sessionId: string | null): EconomyPolicy {
    const key = sessionId ?? ''
    let policy = this.policies.get(key)
    if (!policy) {
      policy = createPolicy(this.options.config.filterOptions)
      this.policies.set(key, policy)
      if (this.policies.size > 256) this.policies.delete(this.policies.keys().next().value!)
    }
    return policy
  }

  /**
   * Decide and, for a projection in apply mode, save the original and source
   * map. Passes and previews are journaled here. A returned `Prepared` must be
   * committed (journaled) before its text reaches the model.
   */
  prepare(request: EconomyRequest): Prepared | EconomyOutput {
    const { options } = this
    const estimate = options.estimateTokens ?? defaultEstimate
    const measure = (text: string): TextMeasure => ({ sha256: sha256(text), bytes: Buffer.byteLength(text, 'utf8'), tokens: estimate(text) })
    let policyHash = 'unavailable'
    const base = () => ({
      schemaVersion: 1 as const, type: 'economy/decision' as const, time: (options.now?.() ?? new Date()).toISOString(),
      host: options.host, sessionId: request.sessionId, callId: request.callId, tool: request.tool,
      command: request.result.command, exitCode: Number.isSafeInteger(request.result.exitCode) ? request.result.exitCode : null,
      delivery: options.delivery, streams: options.streams, mode: options.mode, runtimeVersion: ECONOMY_RUNTIME_VERSION, policyHash,
    })
    try {
      const policy = this.policyFor(request.sessionId)
      policyHash = policy.policyHash
      const decision = decideShellProjection(request.result, { policy, minimumSavedTokens: options.config.minimumSavedTokens, estimateTokens: estimate })
      if (decision.kind === 'pass') {
        const record: EconomyRecord = { ...base(), outcome: 'passed', reason: decision.reason,
          ...decision.matchDetail === undefined ? {} : { matchDetail: decision.matchDetail },
          ...decision.filter === undefined ? {} : { filter: decision.filter },
          ...decision.transformation === undefined ? {} : { transformation: decision.transformation },
          raw: { ...measure(request.result.rendered), stored: false } }
        this.append(record)
        return { record }
      }
      const identity = { filter: decision.filter, transformation: decision.transformation, stream: decision.stream }
      if (options.mode === 'observe') {
        const record: EconomyRecord = { ...base(), outcome: 'previewed', ...identity,
          raw: { ...measure(request.result.rendered), stored: false }, projected: measure(decision.text) }
        this.append(record)
        return { record }
      }
      let raw, map
      try {
        raw = options.artifacts.save(request.result.rendered)
        map = options.artifacts.save(JSON.stringify(decision.sourceMap))
      } catch (error) { return this.failOpen(base(), 'artifact-save-failed', error) }
      const record: EconomyRecord = { ...base(), outcome: 'projected', ...identity,
        raw: { sha256: raw.sha256, bytes: raw.bytes, tokens: decision.rawTokens, stored: true },
        projected: { sha256: sha256(decision.text), bytes: decision.projectedBytes, tokens: decision.projectedTokens },
        sourceMap: map }
      return { kind: 'prepared', text: decision.text, record }
    } catch (error) {
      return this.failOpen(base(), 'engine-error', error)
    }
  }

  /** Journal a prepared projection. Undefined means: deliver the original instead. */
  commit(prepared: Prepared): EconomyOutput {
    const record = { ...prepared.record, time: (this.options.now?.() ?? new Date()).toISOString() }
    try { this.options.journal.append(record) } catch (error) { this.options.onError?.(error); return {} }
    return { text: prepared.text, record }
  }

  /** Decide, save and journal in one step (for wrappers that deliver immediately). */
  process(request: EconomyRequest): EconomyOutput {
    const prepared = this.prepare(request)
    return isPrepared(prepared) ? this.commit(prepared) : prepared
  }

  private append(record: EconomyRecord): void {
    try { this.options.journal.append(record) } catch (error) { this.options.onError?.(error) }
  }

  private failOpen(base: Omit<EconomyRecord, 'outcome'>, reason: EconomyFailure, error: unknown): EconomyOutput {
    this.options.onError?.(error)
    this.append({ ...base, outcome: 'failed-open', reason })
    return {}
  }
}

/** A projection whose original is saved but which is not yet journaled or delivered. */
export interface Prepared {
  readonly kind: 'prepared'
  readonly text: string
  readonly record: EconomyRecord
}

export function isPrepared(value: Prepared | EconomyOutput): value is Prepared {
  return (value as Prepared).kind === 'prepared'
}

export interface CommandNormalizerOptions {
  readonly host: string
  readonly journal: JournalPort
  readonly now?: () => Date
}

/** Presentation-only rewrites (line numbers, no colour) recorded before execution. */
export function normalizeShellCommand(options: CommandNormalizerOptions,
  call: { sessionId: string | null; callId: string | null; tool: string; command: string }): string | undefined {
  let rewrite
  try { rewrite = rewriteCommand(call.command) } catch { return undefined }
  if (!rewrite) return undefined
  try {
    options.journal.append({ schemaVersion: 1, type: 'economy/command-rewrite', time: (options.now?.() ?? new Date()).toISOString(),
      host: options.host, sessionId: call.sessionId, callId: call.callId, tool: call.tool, rule: rewrite.rule,
      original: call.command, rewritten: rewrite.command })
  } catch { return undefined }
  return rewrite.command
}
