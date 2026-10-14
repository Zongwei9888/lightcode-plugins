/**
 * LightCode for pi. Economy: recognized bash output, and the results of pi's
 * own grep and find, are replaced by a deterministic projection through pi's
 * `context_edit` boundary entries: pi's session file keeps the original
 * result, the model sees the projection from its first read on, and
 * LightCode's journal records the source map and a private copy. LightShadow
 * (./shadow.ts): when pi compacts, tool results become references the model
 * can read again with `lightcode_recall`. Self-evolution (./panel.ts): the
 * `/lightcode` panel and the footer show learned rules and learning runs, and
 * start one in the background with the session's own model as the learner.
 */
import { existsSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExtensionAPI, ExtensionContext, ToolResultEvent, TurnEndEvent } from '@earendil-works/pi-coding-agent'
import { sha256 } from '@lightcode/core'
import {
  cancelEvolution, collectSubagents, describeToolCall, formatTokens, isPrepared, EconomyEngine, LEARNER_INSTRUCTION, nodeBinary, normalizeShellCommand, onPath,
  outcomeSentence, readEvolveStatus, recordSubagent, refreshScan, startEvolution, summarizeEconomy, summarizeShadow, takeAnnouncement,
} from '@lightcode/mechanisms'
import type { BackgroundOptions, EvolveStatus, Prepared } from '@lightcode/mechanisms'
import { HOST_PROFILES, V0_2_SPECS, negotiate } from '@lightcode/protocol'
import type { MechanismMode, Negotiation } from '@lightcode/protocol'
import { FileArtifactStore, FileJournal, RuleStore, collectDaily, dataDirs, loadConfig, readJournals, resolveDataDir, writableDataDir } from '@lightcode/store'
import type { LoadedConfig } from '@lightcode/store'
import { bashShellResult } from './bash.ts'
import { NATIVE_TOOLS, nativeResult } from './native.ts'
import { evolveBadge, panelKey, renderPanel } from './panel.ts'
import type { PanelData, PanelState } from './panel.ts'
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
  /** The learning runner script (the bundled evolve.js next to this file) and node flags for it; tests run the source. */
  readonly runner?: string
  readonly runnerNodeArgs?: readonly string[]
  /** Tests replace the learner (by default pi itself, with the session's model). */
  readonly learner?: (ctx: ExtensionContext) => Learner
}

type Learner = { readonly argv: readonly string[]; readonly shell?: boolean; readonly label: string } | { readonly unavailable: string }
const SUBCOMMANDS = [
  { value: 'learn', description: 'learn output rules from your recorded sessions, in the background' },
  { value: 'cancel', description: 'stop the learning run in progress' },
  { value: 'rules', description: 'the learned rules in use' },
  { value: 'rollback', description: 'go back to the rules in use before the last adoption' },
  { value: 'off', description: 'switch learned rules off' },
  { value: 'on', description: 'switch the last adopted rules back on' },
  { value: 'status', description: 'savings and settings as text' },
]

/** How to run this pi again: the same runtime and script, or the same binary. */
function piCommand(env: NodeJS.ProcessEnv): string[] | undefined {
  const exe = process.execPath, script = process.argv[1]
  if (/^(node|bun)(\.exe)?$/iu.test(basename(exe)) && script && existsSync(script)) return [exe, script]
  if (/^pi(\.exe)?$/iu.test(basename(exe))) return [exe]
  const found = onPath('pi', env)
  return found ? [found] : undefined
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
    // Learned rules live with the configuration; a session pins the set active when it starts.
    const ruleStore = new RuleStore(configDir)
    // Learning runs in its own process, which reads the same LightCode home.
    const runner = options.runner ?? fileURLToPath(new URL('./evolve.js', import.meta.url))
    const background = (): BackgroundOptions | { unavailable: string } => {
      if (!existsSync(runner)) return { unavailable: 'this installation has no learning runner' }
      const node = nodeBinary(env)
      if (!node) return { unavailable: 'needs Node.js on PATH' }
      const childEnv: NodeJS.ProcessEnv = { ...env, LIGHTCODE_HOME: configDir }
      delete childEnv[PARENT_SESSION_ENV]
      return { runner, node, env: childEnv, ...options.runnerNodeArgs ? { nodeArgs: options.runnerNodeArgs } : {} }
    }
    const learnerFor = (ctx: ExtensionContext): Learner => {
      if (options.learner) return options.learner(ctx)
      const model = ctx.model
      if (!model) return { unavailable: 'choose a model first' }
      const command = piCommand(env)
      if (!command) return { unavailable: 'cannot find the pi command' }
      return { argv: [...command, '-p', '--no-session', '--provider', model.provider, '--model', model.id, LEARNER_INSTRUCTION], label: `pi · ${model.id}` }
    }
    const evolveStatus = (): EvolveStatus | undefined => {
      try { return readEvolveStatus(configDir) } catch { return undefined }
    }
    const startLearning = (ctx: ExtensionContext): { ok: boolean; text: string } => {
      const learner = learnerFor(ctx)
      if ('unavailable' in learner) return { ok: false, text: `LightCode cannot learn from here: ${learner.unavailable}.` }
      const runnerOptions = background()
      if ('unavailable' in runnerOptions) return { ok: false, text: `LightCode cannot learn from here: ${runnerOptions.unavailable}.` }
      const started = startEvolution(configDir, { ...runnerOptions, host: HOST, learner })
      if ('error' in started) return { ok: false, text: started.error === 'running' ? 'A learning run is already in progress.' : 'The learning run did not start.' }
      watch(ctx)
      return { ok: true, text: `Learning with ${learner.label} in the background. Keep working; LightCode tells you when it is done.` }
    }
    /** The footer and announcements follow learning runs: every second while one runs, every 15 s otherwise. */
    let watchTimer: ReturnType<typeof setTimeout> | undefined
    let wasRunning = false
    const announce = (ctx: ExtensionContext) => {
      if (!ctx.hasUI) return
      const run = takeAnnouncement(configDir, HOST)
      if (run?.outcome && run.outcome.result !== 'nothing-to-learn') {
        ctx.ui.notify(`LightCode learning ${outcomeSentence(run.outcome)}.${run.outcome.result === 'adopted' ? ' /lightcode to review or roll back.' : ''}`,
          run.outcome.result === 'adopted' ? 'info' : run.outcome.result === 'failed' || run.outcome.result === 'interrupted' ? 'warning' : 'info')
      }
    }
    const watch = (ctx: ExtensionContext) => {
      if (watchTimer) clearTimeout(watchTimer)
      const status = evolveStatus()
      const running = status?.run?.running === true
      if (state) showStatus(ctx, state, status)
      if (wasRunning && !running) announce(ctx)
      wasRunning = running
      watchTimer = setTimeout(() => watch(ctx), running ? 1000 : 15_000)
      watchTimer.unref?.()
    }
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
        mode, delivery: 'in-process', streams: 'merged', learned: () => ruleStore.load() })
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
    let lastEvolve: EvolveStatus | undefined
    const showStatus = (ctx: ExtensionContext, session: SessionState, evolve = lastEvolve) => {
      lastEvolve = evolve
      const saved = session.savedTokens + session.subagentSavedTokens
      if (!ctx.hasUI) return
      const badge = evolve ? evolveBadge(evolve, ctx.ui.theme, Date.now()) : ''
      // Nothing to show any more (a run ended, nothing saved yet): clear what was there.
      if (saved <= 0 && !badge) { ctx.ui.setStatus(STATUS_KEY, undefined); return }
      ctx.ui.setStatus(STATUS_KEY, [saved > 0 ? `LightCode −${formatTokens(saved)} tok` : 'LightCode', badge].filter(Boolean).join(' · '))
    }

    pi.on('session_start', (_event, ctx) => {
      state = start(ctx)
      showStatus(ctx, state)
      if (!ctx.hasUI || !state.engine) return
      announce(ctx)
      const runnerOptions = background()
      if (!('unavailable' in runnerOptions)) { try { refreshScan(configDir, runnerOptions) } catch { /* The panel says what it can. */ } }
      watch(ctx)
    })

    pi.on('session_shutdown', () => {
      if (watchTimer) clearTimeout(watchTimer)
      watchTimer = undefined
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

    const statusText = (ctx: ExtensionContext): { text: string; warn: boolean } => {
      const session = current(ctx)
      const summary = summarizeEconomy(session.sessionId ? read(session.sessionId) : [])
      const subagents = session.sessionId ? collectSubagents(read, session.sessionId) : undefined
      const children = subagents ? summarizeEconomy(subagents.records) : undefined
      const n = subagents?.sessions.length ?? 0
      const shadow = summarizeShadow(session.sessionId ? read(session.sessionId) : [])
      const run = evolveStatus()?.run
      const lines = [
        `LightCode Economy: ${summary.projected} outputs filtered, ~${formatTokens(summary.savedTokens)} tokens saved, ${summary.passed} passed unchanged`,
        ...shadow.checkpoints + shadow.standard > 0 ? [`LightShadow: ${shadow.checkpoints} compaction${shadow.checkpoints === 1 ? '' : 's'} with ${shadow.references} tool results kept recallable (~${formatTokens(shadow.referencedTokens)} tokens), ${shadow.recalls} recalled`
          + `${shadow.standard ? `; ${shadow.standard} left to pi` : ''}`] : [],
        ...n > 0 && children ? [`Subagents (${n} session${n === 1 ? '' : 's'}): ${children.projected} outputs filtered, ~${formatTokens(children.savedTokens)} tokens saved, ${children.passed} passed unchanged`] : [],
        learnedRulesLine(ruleStore, session.loaded.config.economy.learnedRules),
        ...run?.running ? [`Learning: in progress with ${run.learner} (${run.phase})`] : run?.outcome ? [`Last learning run: ${outcomeSentence(run.outcome)}`] : [],
        ...session.negotiated.map(item => `${item.mechanism}: ${item.mode} (${item.reason})`),
        ...session.loaded.problems.map(problem => `config problem: ${problem}`),
        `data: ${dataDir}`,
      ]
      return { text: lines.join('\n'), warn: session.loaded.problems.length > 0 }
    }

    const panelData = (ctx: ExtensionContext): PanelData => {
      const session = current(ctx)
      const records = session.sessionId ? read(session.sessionId) : []
      const subagents = session.sessionId ? collectSubagents(read, session.sessionId) : undefined
      const learner = learnerFor(ctx)
      const runnerOptions = background()
      return {
        economy: summarizeEconomy(records), shadow: summarizeShadow(records),
        ...subagents && subagents.sessions.length ? { subagents: { sessions: subagents.sessions.length, summary: summarizeEconomy(subagents.records) } } : {},
        modes: session.negotiated.filter(item => item.mechanism !== 'command-normalization').map(item => `${item.mechanism === 'lightshadow' ? 'shadow' : item.mechanism} ${item.mode}`).join(' · '),
        evolve: evolveStatus() ?? { rules: { active: null, rules: [], history: 0 } },
        learner: 'unavailable' in runnerOptions ? runnerOptions : 'unavailable' in learner ? learner : { label: learner.label },
        learnedRulesOff: !session.loaded.config.economy.learnedRules,
        now: Date.now(),
      }
    }

    const rulesAction = (action: 'rollback' | 'off' | 'on'): string => {
      const active = ruleStore.state().active
      if (action === 'off') {
        if (!active) return 'Learned rules are already off.'
        ruleStore.deactivate()
        return 'Learned rules are off. /lightcode on switches them back on.'
      }
      if (action === 'on' && active) return `Learned rules ${active.slice(0, 12)} are already on.`
      if (action === 'rollback' && !active) return 'No learned rules are active.'
      const now = ruleStore.rollback()
      return now ? `Learned rules ${now.slice(0, 12)} are in use from the next output on.` : 'No learned rules are in use now.'
    }

    const openPanel = async (ctx: ExtensionContext) => {
      // Look at the evidence again now: what is worth learning may have changed in this session.
      const runnerOptions = background()
      if (!('unavailable' in runnerOptions)) { try { refreshScan(configDir, { ...runnerOptions, maxAgeMs: 0 }) } catch { /* Shown as it is. */ } }
      await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
        const panel: PanelState = {}
        let data = panelData(ctx)
        const refresh = (full = false) => {
          const wasRunning = data.evolve.run?.running === true
          try { data = full ? panelData(ctx) : { ...data, evolve: evolveStatus() ?? data.evolve, now: Date.now() } } catch { /* Keep the last view. */ }
          // A note about the run (started, stopping) is over once the run is; its result shows instead.
          if (wasRunning && data.evolve.run?.running !== true) delete panel.message
          tui.requestRender()
        }
        const timer = setInterval(() => refresh(), 1000)
        timer.unref?.()
        const close = () => { clearInterval(timer); done(undefined) }
        return {
          render: (width: number) => renderPanel(data, panel, width, theme),
          invalidate: () => {},
          handleInput: (input: string) => {
            const key = panelKey(input, panel)
            if (key === undefined) return
            if (key === 'close') { close(); return }
            if (key === 'back') { delete panel.confirming; refresh(); return }
            if (key === 'confirm') {
              const action = panel.confirming
              delete panel.confirming
              if (action === 'learn') {
                const started = startLearning(ctx)
                panel.message = { tone: started.ok ? 'success' : 'error', text: started.ok ? 'Learning started in the background. You can close this and keep working.' : started.text }
              } else if (action === 'rollback') panel.message = { tone: 'success', text: rulesAction('rollback') }
              refresh(true)
              return
            }
            delete panel.message
            const running = data.evolve.run?.running === true
            if (key === 'learn' && !running && 'label' in data.learner) panel.confirming = 'learn'
            else if (key === 'cancel' && running) panel.message = cancelEvolution(configDir) ? { tone: 'warning', text: 'Stopping the learning run…' } : { tone: 'error', text: 'No learning run to stop.' }
            else if (key === 'rollback' && data.evolve.rules.active) panel.confirming = 'rollback'
            else if (key === 'toggle' && (data.evolve.rules.active || data.evolve.rules.history > 0)) panel.message = { tone: 'success', text: rulesAction(data.evolve.rules.active ? 'off' : 'on') }
            refresh(key === 'toggle')
          },
          dispose: () => clearInterval(timer),
        }
      }, { overlay: true, overlayOptions: { anchor: 'center', width: 92, maxHeight: '90%' } })
      const session = current(ctx)
      showStatus(ctx, session, evolveStatus())
    }

    pi.registerCommand('lightcode', {
      description: 'LightCode: savings, learned rules and learning (/lightcode learn, cancel, rules, rollback, off, on, status)',
      getArgumentCompletions: (prefix: string) => {
        const items = SUBCOMMANDS.filter(item => item.value.startsWith(prefix.trim())).map(item => ({ value: item.value, label: item.value, description: item.description }))
        return items.length ? items : null
      },
      handler: async (args, ctx) => {
        const sub = args.trim().split(/\s+/u)[0] ?? ''
        if (sub === '' && ctx.mode === 'tui') { await openPanel(ctx); return }
        if (sub === '' || sub === 'status') { const { text, warn } = statusText(ctx); ctx.ui.notify(text, warn ? 'warning' : 'info'); return }
        if (sub === 'learn') {
          const learner = learnerFor(ctx)
          if ('unavailable' in learner) { ctx.ui.notify(`LightCode cannot learn from here: ${learner.unavailable}.`, 'warning'); return }
          if (!ctx.hasUI) { ctx.ui.notify('Run /lightcode learn in an interactive session, or lc evolve in a terminal.', 'warning'); return }
          const ok = await ctx.ui.confirm('Learn output rules?', `LightCode runs ${learner.label} in the background. It reads up to 40 recorded outputs from this machine, sends them to that model's provider, and stops after 20 minutes. Rules are adopted only if verified.`)
          if (!ok) return
          const started = startLearning(ctx)
          ctx.ui.notify(started.text, started.ok ? 'info' : 'warning')
          return
        }
        if (sub === 'cancel') { ctx.ui.notify(cancelEvolution(configDir) ? 'Stopping the learning run.' : 'No learning run in progress.', 'info'); return }
        if (sub === 'rules') {
          const view = evolveStatus()?.rules
          ctx.ui.notify(view?.active ? [`Learned rules ${view.active.slice(0, 12)}:`, ...view.rules.map(rule => `  ${rule.id} (${rule.transformation})`)].join('\n')
            : 'No learned rules are active. /lightcode learn learns some from your recorded sessions.', 'info')
          return
        }
        if (sub === 'rollback' || sub === 'off' || sub === 'on') { ctx.ui.notify(rulesAction(sub), 'info'); watch(ctx); return }
        ctx.ui.notify(`Unknown /lightcode ${sub}. Try: ${SUBCOMMANDS.map(item => item.value).join(', ')}.`, 'warning')
      },
    })
  }
}

/** Only deliver a projection of exactly the text pi recorded (another extension may have changed it). */
function sameText(content: readonly { type: string; text?: string }[], prepared: Prepared): boolean {
  return content.length === 1 && content[0]!.type === 'text' && prepared.record.raw !== undefined
    && sha256(content[0]!.text ?? '') === prepared.record.raw.sha256
}

/** The learned rules new sessions use, for `/lightcode`. */
export function learnedRulesLine(store: RuleStore, enabled: boolean): string {
  const active = store.state().active
  if (!active) return 'Learned rules: none (/lightcode learn learns them from your sessions)'
  const set = store.load()
  return `Learned rules: ${active.slice(0, 12)}, ${set ? `${set.rules.length} rule${set.rules.length === 1 ? '' : 's'}` : 'not loadable'}${enabled ? '' : ' (off: economy.learnedRules is false)'}`
}

function rank(mode: MechanismMode): number {
  return mode === 'apply' ? 2 : mode === 'observe' ? 1 : 0
}

export default createLightCodeExtension()
