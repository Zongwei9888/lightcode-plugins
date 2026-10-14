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

export interface StreamSpan {
  readonly start: number
  readonly length: number
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
  /** The learned rule, when `filter` is `learned-rule`. */
  readonly rule?: string
  readonly transformation?: EconomyTransformation
  readonly stream?: 'stdout' | 'stderr'
  readonly runtimeVersion: string
  readonly policyHash: string
  /** Content hash of the learned rules the policy tried first, when there were any. */
  readonly learnedRulesHash?: string
  /**
   * The original as the model would have seen it; `stored` means it is in the
   * artifact store (always for a projection; for other outcomes when evidence
   * for `lc evolve` is kept).
   */
  readonly raw?: TextMeasure & { readonly stored: boolean }
  /** Where stdout (and stderr, when the host keeps it apart) sit in the original, in UTF-16 units. */
  readonly layout?: { readonly stdout: StreamSpan; readonly stderr?: StreamSpan; readonly truncated?: true; readonly interrupted?: true }
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

/** A tool result LightShadow saved and replaced by a reference when the host compacted its history. */
export interface ShadowReference {
  /** `o-` and the first 12 hex digits of `sha256`: the ID the model passes to `recall`. */
  readonly id: string
  /** The text the model read, in the artifact store. */
  readonly sha256: string
  readonly bytes: number
  readonly tool: string
  readonly callId: string | null
  /** At most 320 bytes: the first two and last two non-empty lines. */
  readonly excerpt: string
  /** The complete output, when Economy delivered a shortened projection of it. */
  readonly original?: ArtifactRef
}

/**
 * One compaction. `lightshadow`: the checkpoint (summary, exact user
 * messages, catalog) replaced the segment. `standard`: the host's own
 * compaction ran instead, for `reason`. `cut`: the host cut long results to a
 * head and tail, and LightShadow kept each complete text recallable.
 */
export interface ShadowCheckpointRecord extends JournalBase {
  readonly type: 'shadow/checkpoint'
  readonly kind: 'lightshadow' | 'standard' | 'cut'
  readonly references: readonly ShadowReference[]
  readonly userMessages: number
  readonly segmentTokens: number
  readonly checkpointTokens: number
  readonly reason?: 'checkpoint-not-smaller' | 'observe' | 'error'
}

/** A `recall` call: which reference, and whether it was found. */
export interface ShadowRecallRecord extends JournalBase {
  readonly type: 'shadow/recall'
  readonly callId: string | null
  readonly id: string
  readonly original: boolean
  readonly outcome: 'returned' | 'window' | 'failed'
  readonly bytes: number
}

export type JournalRecord = EconomyRecord | CommandRewriteRecord | SubagentRecord | ShadowCheckpointRecord | ShadowRecallRecord

/** Private, append-only. Writes are synchronous so a short-lived `lc run` never loses one. */
export interface JournalPort {
  append(record: JournalRecord): void
}

/** Private original-output store. `read` returns undefined once retention has removed the text. */
export interface ArtifactPort {
  save(text: string): ArtifactRef
  read(sha256: string): string | undefined
}
