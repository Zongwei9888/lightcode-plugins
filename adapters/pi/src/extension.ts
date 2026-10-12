/**
 * LightCode for pi. Recognized bash output is replaced by a deterministic
 * projection through pi's `context_edit` boundary entries: pi's session file
 * keeps the original result, the model sees the projection from its first
 * read on, and LightCode's journal records the source map and a private copy.
 */
import type { ExtensionAPI, ExtensionContext, ToolResultEvent, TurnEndEvent } from '@earendil-works/pi-coding-agent'
import { sha256 } from '@lightcode/core'
import { formatTokens, isPrepared, EconomyEngine, normalizeShellCommand, summarizeEconomy } from '@lightcode/mechanisms'
import type { Prepared } from '@lightcode/mechanisms'
import { HOST_PROFILES, V0_1_SPECS, negotiate } from '@lightcode/protocol'
import type { MechanismMode, Negotiation } from '@lightcode/protocol'
import { FileArtifactStore, FileJournal, collectDaily, dataDirs, loadConfig, readJournals, resolveDataDir, writableDataDir } from '@lightcode/store'
import type { LoadedConfig } from '@lightcode/store'
import { bashShellResult } from './bash.ts'

const HOST = 'pi'
const STATUS_KEY = 'lightcode'
const MODES = new Set<MechanismMode>(['apply', 'observe', 'off'])

export interface LightCodePiOptions {
  /** Defaults to `$LIGHTCODE_HOME` or `~/.lightcode`. */
  readonly dataDir?: string
  readonly env?: NodeJS.ProcessEnv
}

interface SessionState {
  readonly sessionId: string | null
  readonly loaded: LoadedConfig
  readonly negotiated: readonly Negotiation[]
  readonly engine: EconomyEngine | undefined
  readonly normalize: boolean
  /** Prepared projections by tool call ID, waiting for their turn to end. */
  readonly pending: Map<string, Prepared>
  savedTokens: number
  projected: number
}

export function createLightCodeExtension(options: LightCodePiOptions = {}) {
  return function lightcode(pi: ExtensionAPI): void {
    const env = options.env ?? process.env
    const configDir = options.dataDir ?? resolveDataDir(env)
    const dataDir = options.dataDir ?? writableDataDir(env) ?? configDir
    const readDirs = options.dataDir ? [options.dataDir] : dataDirs(env)
    const journal = new FileJournal(dataDir)
    const artifacts = new FileArtifactStore(dataDir)
    let state: SessionState | undefined

    pi.registerFlag('lightcode', { type: 'string', default: '', description: 'LightCode Economy ceiling: apply, observe or off' })

    const start = (ctx: ExtensionContext): SessionState => {
      const loaded = loadConfig({ dataDir: configDir, cwd: ctx.cwd, env })
      const flag = String(pi.getFlag('lightcode') ?? '').trim() as MechanismMode
      const economyCeiling = MODES.has(flag) && rank(flag) < rank(loaded.config.economy.mode) ? flag : loaded.config.economy.mode
      const negotiated = negotiate(V0_1_SPECS, HOST_PROFILES[HOST]!.capabilities, {
        economy: economyCeiling, 'command-normalization': loaded.config.economy.commandNormalization && economyCeiling === 'apply' ? 'apply' : 'off',
      })
      const mode = negotiated.find(item => item.mechanism === 'economy')!.mode
      const sessionId = ctx.sessionManager.getSessionId() || null
      const engine = mode === 'off' ? undefined : new EconomyEngine({ host: HOST, journal, artifacts, config: loaded.config.economy,
        mode, delivery: 'in-process', streams: 'merged' })
      const previous = sessionId ? summarizeEconomy(readJournals(readDirs, { host: HOST, sessionId })) : undefined
      try { collectDaily(dataDir, days => artifacts.prune(days), loaded.config.artifacts.retentionDays) } catch { /* Housekeeping only. */ }
      return {
        sessionId, loaded, negotiated, engine,
        normalize: negotiated.find(item => item.mechanism === 'command-normalization')!.mode === 'apply',
        pending: new Map(), savedTokens: previous?.savedTokens ?? 0, projected: previous?.projected ?? 0,
      }
    }
    const current = (ctx: ExtensionContext): SessionState => {
      const sessionId = ctx.sessionManager.getSessionId() || null
      if (!state || state.sessionId !== sessionId) state = start(ctx)
      return state
    }
    const showStatus = (ctx: ExtensionContext, session: SessionState) => {
      if (!ctx.hasUI || session.projected === 0) return
      ctx.ui.setStatus(STATUS_KEY, `LightCode −${formatTokens(session.savedTokens)} tok`)
    }

    pi.on('session_start', (_event, ctx) => {
      state = start(ctx)
      showStatus(ctx, state)
    })

    pi.on('tool_call', (event, ctx) => {
      if (event.toolName !== 'bash') return
      const session = current(ctx)
      const input = event.input as { command?: unknown }
      if (!session.normalize || typeof input.command !== 'string') return
      const rewritten = normalizeShellCommand({ host: HOST, journal }, {
        sessionId: session.sessionId, callId: event.toolCallId, tool: 'bash', command: input.command,
      })
      // pi runs the mutated input; the assistant message in the session keeps the original command.
      if (rewritten !== undefined) input.command = rewritten
    })

    pi.on('tool_result', (event: ToolResultEvent, ctx) => {
      const session = current(ctx)
      if (!session.engine || event.toolName !== 'bash' || event.parentToolCallId !== undefined) return
      const result = bashShellResult(event)
      if (!result) return
      const prepared = session.engine.prepare({ sessionId: session.sessionId, callId: event.toolCallId, tool: 'bash', result })
      if (isPrepared(prepared)) {
        session.pending.set(event.toolCallId, prepared)
        if (session.pending.size > 256) session.pending.delete(session.pending.keys().next().value!)
      }
      // Return nothing: pi records the original result; the projection arrives at turn_end.
    })

    pi.on('turn_end', (event: TurnEndEvent, ctx) => {
      const session = current(ctx)
      if (!session.engine || session.pending.size === 0) return
      const drafts = []
      // Entry IDs are only trustworthy when pi resolved one for every tool result.
      const aligned = event.toolResultEntryIds.length === event.toolResults.length
      for (const [index, message] of event.toolResults.entries()) {
        const prepared = session.pending.get(message.toolCallId)
        if (!prepared) continue
        session.pending.delete(message.toolCallId)
        const targetId = event.toolResultEntryIds[index]
        if (!aligned || !targetId || !sameText(message.content, prepared)) continue
        const committed = session.engine.commit(prepared)
        if (committed.text === undefined) continue
        drafts.push({ type: 'context_edit' as const, targetId, replacement: { content: [{ type: 'text' as const, text: committed.text }] } })
        session.projected++
        session.savedTokens += prepared.record.raw!.tokens - prepared.record.projected!.tokens
      }
      if (drafts.length === 0) return
      showStatus(ctx, session)
      // Keep entries other extensions added at this boundary.
      return { entries: [...event.entries, ...drafts] }
    })

    pi.registerCommand('lightcode', {
      description: 'LightCode: savings in this session and what this host supports',
      handler: async (_args, ctx) => {
        const session = current(ctx)
        const summary = summarizeEconomy(session.sessionId ? readJournals(readDirs, { host: HOST, sessionId: session.sessionId }) : [])
        const lines = [
          `LightCode Economy: ${summary.projected} outputs filtered, ~${formatTokens(summary.savedTokens)} tokens saved, ${summary.passed} passed unchanged`,
          ...session.negotiated.map(item => `${item.mechanism}: ${item.mode} (${item.reason})`),
          ...session.loaded.problems.map(problem => `config problem: ${problem}`),
          `data: ${dataDir}`,
        ]
        ctx.ui.notify(lines.join('\n'), session.loaded.problems.length ? 'warning' : 'info')
      },
    })
  }
}

/** Only deliver a projection of exactly the text pi recorded (another extension may have changed it). */
function sameText(content: readonly { type: string; text?: string }[], prepared: Prepared): boolean {
  return content.length === 1 && content[0]!.type === 'text' && prepared.record.raw !== undefined
    && sha256(content[0]!.text ?? '') === prepared.record.raw.sha256
}

function rank(mode: MechanismMode): number {
  return mode === 'apply' ? 2 : mode === 'observe' ? 1 : 0
}

export default createLightCodeExtension()
