import type { EconomyFilterName, EconomyMatchDetail, EconomyPassReason, EconomyTransformation, CommandRewriteRule } from '@lightcode/core'

/**
 * LightCode's own records. They live in LightCode's private journal, never in
 * the model context, and are anchored to host identifiers (session and tool
 * call IDs) so no host needs a patch to carry them.
 */
export interface JournalBase {
  readonly schemaVersion: 1
  readonly type: string
  /** ISO-8601 time of the decision. */
  readonly time: string
  readonly host: string
  /** Host session identifier; null when the host does not expose one. */
  readonly sessionId: string | null
}

/** Content-addressed reference into the private artifact store. */
export interface ArtifactRef {
  readonly sha256: string
  readonly bytes: number
}

export interface TextMeasure {
  readonly sha256: string
  readonly bytes: number
  readonly tokens: number
}

export type EconomyOutcome = 'projected' | 'previewed' | 'passed' | 'failed-open'

export type EconomyFailure = 'artifact-save-failed' | 'journal-failed' | 'engine-error' | 'output-not-utf8' | 'output-too-large'

export interface EconomyRecord extends JournalBase {
  readonly type: 'economy/decision'
  readonly callId: string | null
  readonly tool: string
  readonly command: string
  readonly exitCode: number | null
  /** How the projection reaches the model: inside the host process, or by `lc run`. */
  readonly delivery: 'in-process' | 'command-wrapper'
  /** Whether the host keeps stdout and stderr apart. Merged streams are filtered as one text. */
  readonly streams: 'separate' | 'merged'
  readonly mode: 'apply' | 'observe'
  readonly outcome: EconomyOutcome
  readonly reason?: EconomyPassReason | EconomyFailure
  readonly matchDetail?: EconomyMatchDetail
  readonly filter?: EconomyFilterName
  readonly transformation?: EconomyTransformation
  readonly stream?: 'stdout' | 'stderr'
  readonly runtimeVersion: string
  readonly policyHash: string
  /** The original as the model would have seen it; `stored` means it is in the artifact store. */
  readonly raw?: TextMeasure & { readonly stored: boolean }
  readonly projected?: TextMeasure
  /** Source map from projection to original, saved as a JSON artifact. */
  readonly sourceMap?: ArtifactRef
}

export interface CommandRewriteRecord extends JournalBase {
  readonly type: 'economy/command-rewrite'
  readonly callId: string | null
  readonly tool: string
  readonly rule: CommandRewriteRule
  readonly original: string
  readonly rewritten: string
}

/**
 * A subagent's session, recorded under the session that started it, so that
 * session's report can include what its subagents saved.
 */
export interface SubagentRecord extends JournalBase {
  readonly type: 'session/subagent'
  readonly sessionId: string
  readonly childSessionId: string
}

export type JournalRecord = EconomyRecord | CommandRewriteRecord | SubagentRecord

/** Private, append-only. Writes are synchronous so a short-lived `lc run` never loses one. */
export interface JournalPort {
  append(record: JournalRecord): void
}

/** Private original-output store. `read` returns undefined once retention has removed the text. */
export interface ArtifactPort {
  save(text: string): ArtifactRef
  read(sha256: string): string | undefined
}
