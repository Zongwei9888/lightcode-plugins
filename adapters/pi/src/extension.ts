/**
 * LightCode for pi. Economy: recognized bash output, and the results of pi's
 * own grep and find, are replaced by a deterministic projection through pi's
 * `context_edit` boundary entries: pi's session file keeps the original
 * result, the model sees the projection from its first read on, and
 * LightCode's journal records the source map and a private copy. LightShadow
 * (./shadow.ts): when pi compacts, tool results become references the model
 * can read again with `lightcode_recall`.
 */
import { statSync } from 'node:fs'
import type { ExtensionAPI, ExtensionContext, ToolResultEvent, TurnEndEvent } from '@earendil-works/pi-coding-agent'
import { sha256 } from '@lightcode/core'
import { collectSubagents, describeToolCall, formatTokens, isPrepared, EconomyEngine, normalizeShellCommand, recordSubagent, summarizeEconomy, summarizeShadow } from '@lightcode/mechanisms'
import type { Prepared } from '@lightcode/mechanisms'
import { HOST_PROFILES, V0_2_SPECS, negotiate } from '@lightcode/protocol'
import type { MechanismMode, Negotiation } from '@lightcode/protocol'
import { FileArtifactStore, FileJournal, collectDaily, dataDirs, loadConfig, readJournals, resolveDataDir, writableDataDir } from '@lightcode/store'
import type { LoadedConfig } from '@lightcode/store'
import { bashShellResult } from './bash.ts'
import { NATIVE_TOOLS, nativeResult } from './native.ts'
import { registerLightShadow } from './shadow.ts'
import type { PiShadowOptions } from './shadow.ts'

const HOST = 'pi'
const STATUS_KEY = 'lightcode'
/**
 * Subagents run as `pi` processes started from this one (the subagent example
 * extension and packages built on it), so the session that starts them hands
 * its ID down through the environment they inherit: `pi:<process ID>:<session ID>`.
 * Only a direct child process of the writer takes it up. A later session of
 * the same process (`/new`, `/resume`, `/fork`, `/reload`) or a `pi` started
 * from some other long-lived descendant is no subagent.
 */
export const PARENT_SESSION_ENV = 'LIGHTCODE_PARENT_SESSION'
const PARENT_VALUE = /^pi:([1-9]\d*):(.+)$/
/** pi's own tools; anything else (a subagent tool among them) may have started subagents. */
const BUILT_IN_TOOLS = new Set(['bash', 'read', 'edit', 'write', 'grep', 'find', 'ls'])
const MODES = new Set<MechanismMode>(['apply', 'observe', 'off'])

export interface LightCodePiOptions {
  /** Defaults to `$LIGHTCODE_HOME` or `~/.lightcode`. */
  readonly dataDir?: string
  readonly env?: NodeJS.ProcessEnv
  /** This process and its parent; tests stand in for separate processes. */
  readonly pid?: number
  readonly ppid?: number
  /** Tests replace pi's compaction summarizer. */
  readonly summarize?: PiShadowOptions['summarize']
}

interface SessionState {
  readonly sessionId: string | null
  readonly loaded: LoadedConfig
  readonly negotiated: readonly Negotiation[]
  readonly engine: EconomyEngine | undefined
  readonly normalize: boolean
  readonly shadow: 'apply' | 'observe' | 'off'
  /** Prepared projections by tool call ID, waiting for their turn to end. */
  readonly pending: Map<string, Prepared>
  savedTokens: number
  projected: number
  /** Saved in subagent sessions started from this one. */
  subagentSavedTokens: number
}

export function createLightCodeExtension(options: LightCodePiOptions = {}) {
  return function lightcode(pi: ExtensionAPI): void {
    const env = options.env ?? process.env
    const configDir = options.dataDir ?? resolveDataDir(env)
    const dataDir = options.dataDir ?? writableDataDir(env) ?? configDir
    const readDirs = options.dataDir ? [options.dataDir] : dataDirs(env)
    const journal = new FileJournal(dataDir)
    const artifacts = new FileArtifactStore(dataDir)
    const pid = options.pid ?? process.pid
    const handedDown = PARENT_VALUE.exec(env[PARENT_SESSION_ENV] ?? '')
    const inherited = handedDown && Number(handedDown[1]) === (options.ppid ?? process.ppid) ? handedDown[2] : undefined
    const linked = new Set<string>()
    let state: SessionState | undefined
    const read = (sessionId: string) => readJournals(readDirs, { host: HOST, sessionId })
    // Journal files only grow: their sizes, taken before reading, say whether a total can change.
    const sizes = (sessionIds: readonly string[]) => sessionIds.flatMap(id => readDirs.map(dir => {
      try { return statSync(new FileJournal(dir).fileOf(HOST, id)).size } catch { return -1 }
    })).join(',')
    let subagentCache: { readonly root: string; readonly stamp: string; readonly children: readonly string[]; readonly saved: number } | undefined
    const subagentSaved = (sessionId: string | null): number => {
      if (!sessionId) return 0
      const known = subagentCache?.root === sessionId ? subagentCache.children : []
      const stamp = sizes([sessionId, ...known])
      if (subagentCache?.root === sessionId && subagentCache.stamp === stamp) return subagentCache.saved
      const found = collectSubagents(read, sessionId)
      const saved = summarizeEconomy(found.records).savedTokens
      // A newly found subagent changes the stamp's shape, so the next call reads once more.
      subagentCache = { root: sessionId, stamp, children: found.sessions, saved }
      return saved
    }

    pi.registerFlag('lightcode', { type: 'string', default: '', description: 'LightCode ceiling for Economy and LightShadow: apply, observe or off' })

    const start = (ctx: ExtensionContext): SessionState => {
      const loaded = loadConfig({ dataDir: configDir, cwd: ctx.cwd, env })
      const flag = String(pi.getFlag('lightcode') ?? '').trim() as MechanismMode
      const lower = (own: MechanismMode) => MODES.has(flag) && rank(flag) < rank(own) ? flag : own
      const economyCeiling = lower(loaded.config.economy.mode)
      const negotiated = negotiate(V0_2_SPECS, HOST_PROFILES[HOST]!.capabilities, {
        economy: economyCeiling, 'command-normalization': loaded.config.economy.commandNormalization && economyCeiling === 'apply' ? 'apply' : 'off',
        lightshadow: lower(loaded.config.lightshadow.mode),
      })
      const mode = negotiated.find(item => item.mechanism === 'economy')!.mode
      const sessionId = ctx.sessionManager.getSessionId() || null
      const engine = mode === 'off' ? undefined : new EconomyEngine({ host: HOST, journal, artifacts, config: loaded.config.economy,
        mode, delivery: 'in-process', streams: 'merged' })
      const previous = sessionId ? summarizeEconomy(read(sessionId)) : undefined
      try { collectDaily(dataDir, days => artifacts.prune(days), loaded.config.artifacts.retentionDays) } catch { /* Housekeeping only. */ }
      if (engine && sessionId) {
        if (inherited && inherited !== sessionId && !linked.has(sessionId)) {
          linked.add(sessionId)
          try { recordSubagent(journal, HOST, inherited, sessionId) } catch { /* Only the parent's report loses this session. */ }
        }
        env[PARENT_SESSION_ENV] = `pi:${pid}:${sessionId}`
      }
      return {
        sessionId, loaded, negotiated, engine,
        normalize: negotiated.find(item => item.mechanism === 'command-normalization')!.mode === 'apply',
        shadow: negotiated.find(item => item.mechanism === 'lightshadow')!.mode,
        pending: new Map(), savedTokens: previous?.savedTokens ?? 0, projected: previous?.projected ?? 0,
        subagentSavedTokens: engine ? subagentSaved(sessionId) : 0,
      }
    }
    const current = (ctx: ExtensionContext): SessionState => {
      const sessionId = ctx.sessionManager.getSessionId() || null
      if (!state || state.sessionId !== sessionId) state = start(ctx)
      return state
    }
    const showStatus = (ctx: ExtensionContext, session: SessionState) => {
      const saved = session.savedTokens + session.subagentSavedTokens
      if (!ctx.hasUI || saved <= 0) return
      ctx.ui.setStatus(STATUS_KEY, `LightCode −${formatTokens(saved)} tok`)
    }

    pi.on('session_start', (_event, ctx) => {
      state = start(ctx)
      showStatus(ctx, state)
    })

    registerLightShadow(pi, {
      host: HOST, journal, artifacts,
      mode: ctx => current(ctx).shadow,
      sessionId: ctx => current(ctx).sessionId,
      read,
      ...options.summarize ? { summarize: options.summarize } : {},
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
      if (!session.engine || event.parentToolCallId !== undefined) return
      const call = { sessionId: session.sessionId, callId: event.toolCallId, tool: event.toolName }
      let prepared
      if (event.toolName === 'bash') {
        const result = bashShellResult(event)
        if (!result) return
        prepared = session.engine.prepare({ ...call, result })
      } else if (NATIVE_TOOLS.has(event.toolName)) {
        const native = nativeResult(event)
        if (!native) return
        prepared = session.engine.prepare({ ...call, command: describeToolCall(event.toolName, event.input), native })
      } else return
      if (isPrepared(prepared)) {
        session.pending.set(event.toolCallId, prepared)
        if (session.pending.size > 256) session.pending.delete(session.pending.keys().next().value!)
      }
      // Return nothing: pi records the original result; the projection arrives at turn_end.
    })

    pi.on('turn_end', (event: TurnEndEvent, ctx) => {
      const session = current(ctx)
      if (!session.engine) return
      // A tool pi does not ship may have run subagents; their savings are in the journal by now.
      if (event.toolResults.some(message => !BUILT_IN_TOOLS.has(message.toolName))) {
        const before = session.subagentSavedTokens
        try { session.subagentSavedTokens = subagentSaved(session.sessionId) } catch { /* Status only. */ }
        if (session.subagentSavedTokens !== before) showStatus(ctx, session)
      }
      if (session.pending.size === 0) return
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
        const summary = summarizeEconomy(session.sessionId ? read(session.sessionId) : [])
        const subagents = session.sessionId ? collectSubagents(read, session.sessionId) : undefined
        const children = subagents ? summarizeEconomy(subagents.records) : undefined
        const n = subagents?.sessions.length ?? 0
        const shadow = summarizeShadow(session.sessionId ? read(session.sessionId) : [])
        const lines = [
          `LightCode Economy: ${summary.projected} outputs filtered, ~${formatTokens(summary.savedTokens)} tokens saved, ${summary.passed} passed unchanged`,
          ...shadow.checkpoints + shadow.standard > 0 ? [`LightShadow: ${shadow.checkpoints} compaction${shadow.checkpoints === 1 ? '' : 's'} with ${shadow.references} tool results kept recallable (~${formatTokens(shadow.referencedTokens)} tokens), ${shadow.recalls} recalled`
            + `${shadow.standard ? `; ${shadow.standard} left to pi` : ''}`] : [],
          ...n > 0 && children ? [`Subagents (${n} session${n === 1 ? '' : 's'}): ${children.projected} outputs filtered, ~${formatTokens(children.savedTokens)} tokens saved, ${children.passed} passed unchanged`] : [],
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
