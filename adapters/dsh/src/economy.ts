/**
 * Token Economy over DSH's `tools/post-execute` waterfall, without cordis:
 * `apply` in ./index.ts only wires these functions to the harness.
 */
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { EconomyEngine, formatTokens, summarizeEconomy } from '@lightcode/mechanisms'
import type { EconomySummary } from '@lightcode/mechanisms'
import { HOST_PROFILES, V0_1_SPECS, negotiate } from '@lightcode/protocol'
import type { MechanismMode, Negotiation } from '@lightcode/protocol'
import { FileArtifactStore, FileJournal, collectDaily, dataDirs, loadConfig, readJournals, resolveDataDir, writableDataDir } from '@lightcode/store'
import type { LoadedConfig } from '@lightcode/store'
import { bashShellResult } from './bash.ts'
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from './host.ts'

export const HOST = 'dsh'
export const MODES: readonly MechanismMode[] = ['apply', 'observe', 'off']
const RANK: Record<MechanismMode, number> = { off: 0, observe: 1, apply: 2 }
const MAX_SESSIONS = 256
const MAX_WARNINGS = 32

export interface DshEconomyOptions {
  /** The plugin's live `mode` setting: a ceiling that can only lower LightCode's own configuration. */
  readonly mode: () => MechanismMode
  /** Defaults to `$LIGHTCODE_HOME` or `~/.lightcode`. */
  readonly dataDir?: string
  readonly env?: NodeJS.ProcessEnv
  readonly warn?: (message: string) => void
}

interface SessionState {
  readonly loaded: LoadedConfig
  /** Identity of the configuration files `loaded` was read from; a change reloads them. */
  readonly stamp: string
  readonly engines: Map<'apply' | 'observe', EconomyEngine>
}

export interface DshEconomy {
  /** Transform the downstream decision for one finished tool call; never throws. */
  postExecute(exec: ToolExecution, result: ToolExecutionResult, decision: PostToolDecision): PostToolDecision
  /** Negotiated mechanisms for a session (or the defaults when unknown). */
  negotiated(session?: { id: string; cwd?: string | undefined }): readonly Negotiation[]
  summary(sessionId: string): EconomySummary
  /** The `/lightcode` text for one session. */
  report(session: { id: string; cwd?: string | undefined }): string
  /** Where originals and the journal are written (resolved on first use). */
  readonly dataDir: string
}

const fileStamp = (path: string) => {
  try { const stat = statSync(path); return `${stat.mtimeMs}:${stat.size}` } catch { return '-' }
}

export function createDshEconomy(options: DshEconomyOptions): DshEconomy {
  const env = options.env ?? process.env
  const configDir = options.dataDir ?? resolveDataDir(env)
  const readDirs = options.dataDir ? [options.dataDir] : dataDirs(env)
  // Nothing is created on disk until LightCode first has something to keep.
  let store: { dataDir: string; journal: FileJournal; artifacts: FileArtifactStore } | undefined
  const storage = () => {
    if (!store) {
      const dataDir = options.dataDir ?? writableDataDir(env) ?? configDir
      store = { dataDir, journal: new FileJournal(dataDir), artifacts: new FileArtifactStore(dataDir) }
    }
    return store
  }
  const sessions = new Map<string, SessionState>()
  const warned = new Set<string>()
  const warn = (message: string) => {
    if (warned.has(message) || warned.size >= MAX_WARNINGS) return
    warned.add(message)
    options.warn?.(message)
  }
  let lastCollected = 0

  const requestedMode = (): MechanismMode => {
    try {
      const requested = options.mode()
      return MODES.includes(requested) ? requested : 'off'
    } catch { return 'off' }
  }

  const sessionState = (id: string, cwd: string | undefined): SessionState => {
    const stamp = `${fileStamp(join(configDir, 'config.json'))}|${cwd === undefined ? '' : fileStamp(join(cwd, '.lightcode', 'config.json'))}`
    let state = sessions.get(id)
    if (!state || state.stamp !== stamp) {
      const loaded = loadConfig({ dataDir: configDir, ...cwd === undefined ? {} : { cwd }, env })
      state = { loaded, stamp, engines: new Map() }
      sessions.delete(id)
      sessions.set(id, state)
      if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value!)
    }
    return state
  }

  const negotiateFor = (loaded: LoadedConfig, requested = requestedMode()): readonly Negotiation[] => {
    const own = loaded.config.economy.mode
    const ceiling = RANK[requested] < RANK[own] ? requested : own
    // DSH 0.2 cannot rewrite tool arguments, so command normalization negotiates off.
    return negotiate(V0_1_SPECS, HOST_PROFILES[HOST]!.capabilities, { economy: ceiling, 'command-normalization': 'off' })
  }

  const engineFor = (state: SessionState, mode: 'apply' | 'observe'): EconomyEngine => {
    let engine = state.engines.get(mode)
    if (!engine) {
      const { journal, artifacts } = storage()
      engine = new EconomyEngine({ host: HOST, journal, artifacts, config: state.loaded.config.economy, mode,
        delivery: 'in-process', streams: 'separate', onError: error => warn(`LightCode: ${String(error)}; delivering the original output`) })
      state.engines.set(mode, engine)
    }
    return engine
  }

  /** Expire old originals at most daily, after the current tool result has been delivered. */
  const housekeeping = (retentionDays: number) => {
    const now = Date.now()
    if (now - lastCollected < 3_600_000) return
    lastCollected = now
    const { dataDir, artifacts } = storage()
    setTimeout(() => {
      try { collectDaily(dataDir, days => artifacts.prune(days), retentionDays) } catch { /* Housekeeping only. */ }
    }, 0).unref?.()
  }

  const sessionOf = (exec: ToolExecution) => {
    const session = exec.agent?.session
    return session === undefined ? undefined : { id: String(session.id), cwd: session.header?.cwd }
  }

  const postExecute = (exec: ToolExecution, result: ToolExecutionResult, decision: PostToolDecision): PostToolDecision => {
    try {
      const requested = requestedMode()
      if (requested === 'off') return decision
      // Only the model's own bash calls: a run_code sub-dispatch hands its value to a program, not the model.
      if (exec.name !== 'bash' || exec.parent !== undefined || result.isError) return decision
      // Keep blocks, value replacements and anything another listener already rewrote.
      if (decision.kind !== 'accept' || Object.hasOwn(decision, 'value')) return decision
      const session = sessionOf(exec)
      const state = sessionState(session?.id ?? '', session?.cwd)
      const mode = negotiateFor(state.loaded, requested).find(item => item.mechanism === 'economy')!.mode
      if (mode === 'off') return decision
      const content = decision.content ?? result.content
      const shell = bashShellResult((exec.arguments as { command?: unknown } | undefined)?.command, result.value, content)
      if (!shell) return decision
      const output = engineFor(state, mode).process({ sessionId: session?.id ?? null, callId: String(exec.callId), tool: 'bash', result: shell })
      housekeeping(state.loaded.config.artifacts.retentionDays)
      if (output.text === undefined) return decision
      return { kind: 'accept', content: [{ type: 'text', text: output.text }],
        ...decision.additionalContexts === undefined ? {} : { additionalContexts: decision.additionalContexts } }
    } catch (error) {
      warn(`LightCode: ${String(error)}; delivering the original output`)
      return decision
    }
  }

  const summary = (sessionId: string) => summarizeEconomy(readJournals(readDirs, { host: HOST, sessionId }))

  return {
    postExecute,
    negotiated: session => negotiateFor(session ? sessionState(session.id, session.cwd).loaded : loadConfig({ dataDir: configDir, env })),
    summary,
    report: session => {
      const loaded = sessionState(session.id, session.cwd).loaded
      const s = summary(session.id)
      const lines = [
        s.projected > 0
          ? `LightCode saved ~${formatTokens(s.savedTokens)} tokens in this session (${s.projected} of ${s.projected + s.passed + s.previewed} outputs filtered).`
          : `LightCode has not filtered any output in this session yet (${s.passed + s.previewed} seen).`,
        ...s.previewed > 0 ? [`Observe mode: ${s.previewed} outputs would have been filtered, saving ~${formatTokens(s.previewSavedTokens)} tokens.`] : [],
        ...s.byFilter.slice(0, 5).map(item => `  ${item.filter}: ${item.count}× −${formatTokens(item.savedTokens)} tokens`),
        ...negotiateFor(loaded).map(item => `${item.mechanism}: ${item.mode} (${item.reason})`),
        ...loaded.problems.map(problem => `config problem: ${problem}`),
        `Originals are kept in ${store?.dataDir ?? options.dataDir ?? writableDataDir(env) ?? configDir}.`,
      ]
      return lines.join('\n')
    },
    get dataDir() { return storage().dataDir },
  }
}
