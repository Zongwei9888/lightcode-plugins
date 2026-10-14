/**
 * The `/lightcode` panel in pi's terminal UI: this session's savings,
 * LightShadow, and self-evolution (learned rules, what is worth learning next,
 * a run in progress and the last result), with keys to start, cancel or roll
 * back learning. Rendering is a pure function of the data and the panel's
 * state, so tests can check it without a terminal.
 */
import { matchesKey, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import { formatTokens, outcomeSentence } from '@lightcode/mechanisms'
import type { EconomySummary, EvolveStatus, ShadowSummary } from '@lightcode/mechanisms'

/** The members of pi's Theme the panel uses. */
export interface PanelTheme {
  fg(color: 'accent' | 'border' | 'borderAccent' | 'muted' | 'dim' | 'success' | 'warning' | 'error' | 'text', text: string): string
  bold(text: string): string
}

export interface PanelData {
  readonly economy: EconomySummary
  readonly shadow: ShadowSummary
  readonly subagents?: { readonly sessions: number; readonly summary: EconomySummary }
  readonly modes: string
  readonly evolve: EvolveStatus
  /** The learner a run started here would use, or why none can start. */
  readonly learner: { readonly label: string } | { readonly unavailable: string }
  /** Learned rules switched off by `economy.learnedRules: false`. */
  readonly learnedRulesOff: boolean
  readonly now: number
}

export type PanelAction = 'learn' | 'cancel' | 'rollback' | 'toggle'
export interface PanelState {
  /** An action waiting for y/n. */
  confirming?: 'learn' | 'rollback'
  message?: { readonly tone: 'success' | 'warning' | 'error'; readonly text: string }
}

const MAX_WIDTH = 92
const SPINNER = ['◐', '◓', '◑', '◒']

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, '0')}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function ago(iso: string | undefined, now: number): string {
  if (!iso) return ''
  const minutes = Math.round((now - Date.parse(iso)) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

/** The footer's self-evolution part: a learner at work, a run worth starting, or nothing. */
export function evolveBadge(evolve: EvolveStatus, theme: PanelTheme, now: number): string {
  const run = evolve.run
  if (run?.running) {
    const frame = SPINNER[Math.floor(now / 1000) % SPINNER.length]
    return theme.fg('warning', `${frame} learning ${elapsed(now - Date.parse(run.startedAt))}`)
  }
  if (evolve.scan?.ready) return theme.fg('accent', '✦ ready to learn')
  return ''
}

const pad = (text: string, width: number) => {
  const clipped = truncateToWidth(text, width)
  return clipped + ' '.repeat(Math.max(0, width - visibleWidth(clipped)))
}

/** Left and right parts on one line of `width`, the right one flush right. */
const spread = (left: string, right: string, width: number) => {
  const gap = width - visibleWidth(left) - visibleWidth(right)
  return gap >= 1 ? left + ' '.repeat(gap) + right : pad(left, width)
}

/** Words of `text` (which may carry colors) in lines of at most `width` columns. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (line && visibleWidth(next) > width) { lines.push(line); line = word } else line = next
  }
  if (line) lines.push(line)
  return lines.map(part => visibleWidth(part) > width ? truncateToWidth(part, width) : part)
}

const bar = (value: number, max: number, cells: number) => {
  const filled = max <= 0 ? 0 : Math.max(1, Math.round(value / max * cells))
  return '▰'.repeat(filled) + '▱'.repeat(Math.max(0, cells - filled))
}

export function renderPanel(data: PanelData, state: PanelState, width: number, theme: PanelTheme): string[] {
  const outer = Math.max(40, Math.min(MAX_WIDTH, width))
  const inner = outer - 4
  const t = theme
  const LABEL = 15
  const label = (text: string) => t.fg('muted', text.padEnd(LABEL))
  const heading = (text: string) => t.bold(t.fg('dim', text))
  const lines: string[] = []
  const row = (text = '') => lines.push(text)

  row(spread(`${t.fg('accent', '◆')} ${t.bold('LightCode')}`, t.fg('dim', data.modes), inner))
  row()

  // This session.
  row(heading('THIS SESSION'))
  const e = data.economy
  row(spread(`${label('Economy')}${e.projected} of ${e.projected + e.passed + e.previewed} outputs filtered`,
    e.savedTokens > 0 ? t.fg('success', `−${formatTokens(e.savedTokens)} tokens`) : t.fg('dim', 'nothing saved yet'), inner))
  if (e.previewed > 0) row(`${label('')}${t.fg('dim', `observe mode: ${e.previewed} would have saved ~${formatTokens(e.previewSavedTokens)}`)}`)
  const s = data.shadow
  row(`${label('LightShadow')}${s.checkpoints + s.standard === 0 ? t.fg('dim', 'no compaction yet')
    : `${s.checkpoints} compaction${s.checkpoints === 1 ? '' : 's'} · ${s.references} results recallable · ${s.recalls} recalled`}`)
  if (data.subagents && data.subagents.sessions > 0) {
    const c = data.subagents.summary
    row(spread(`${label('Subagents')}${data.subagents.sessions} session${data.subagents.sessions === 1 ? '' : 's'} · ${c.projected} outputs filtered`,
      t.fg('success', `−${formatTokens(c.savedTokens)} tokens`), inner))
  }
  row()

  // Self-evolution.
  const { run, scan, rules } = data.evolve
  const badge = run?.running ? t.fg('warning', `● ${run.phase === 'verifying' ? 'Verifying' : run.phase === 'learning' ? 'Learning' : 'Starting'} ${elapsed(data.now - Date.parse(run.startedAt))}`)
    : scan?.ready ? t.fg('accent', '✦ Ready to learn') : rules.active ? t.fg('success', '✓ Rules active') : t.fg('dim', '○ Collecting')
  row(spread(heading('SELF-EVOLUTION'), badge, inner))

  if (run?.running) {
    const step = (name: string, phase: 'preparing' | 'learning' | 'verifying') => {
      const order = ['starting', 'preparing', 'learning', 'verifying']
      const at = order.indexOf(run.phase), mine = order.indexOf(phase)
      return at > mine ? t.fg('success', `✓ ${name}`) : at === mine || (phase === 'preparing' && run.phase === 'starting') ? t.fg('warning', `● ${name}`) : t.fg('dim', `○ ${name}`)
    }
    row(`${label('Progress')}${step('Prepare', 'preparing')}  ${t.fg('dim', '─')}  ${step('Learn', 'learning')}  ${t.fg('dim', '─')}  ${step('Verify', 'verifying')}`)
    row(`${label('Learner')}${run.learner}${run.shown ? t.fg('dim', ` · reading ${run.shown} of ${run.evidence} recorded outputs`) : ''}`)
    if (run.checks > 0) {
      const last = run.lastCheck!
      row(`${label('Checks')}${run.checks} so far · last ${last.accepted ? t.fg('success', `passes (+${formatTokens(last.gainTokens ?? 0)})`) : t.fg('warning', 'not yet accepted')}`)
    }
  }

  if (rules.active) {
    const parts = [`${rules.rules.length} active`, rules.adoptedAt ? `adopted ${ago(rules.adoptedAt, data.now)}` : '',
      rules.gainTokens !== undefined ? `+${formatTokens(rules.gainTokens)} on ${rules.cases} outputs` : ''].filter(Boolean)
    row(`${label('Rules')}${parts.join(' · ')}${data.learnedRulesOff ? t.fg('warning', ' · off in config') : ''}`)
    const uses = new Map((scan?.rules ?? []).map(use => [use.id, use]))
    for (const rule of rules.rules.slice(0, 6)) {
      const use = uses.get(rule.id)
      const stats = use ? `${String(use.projections).padStart(4)}× ${t.fg('success', `−${formatTokens(use.savedTokens)}`.padStart(8))}${use.originalRecalls ? t.fg('warning', `  ↺ ${use.originalRecalls}`) : ''}` : t.fg('dim', 'not used yet')
      row(spread(`${label('')}${t.fg('accent', '•')} ${rule.id}`, stats, inner))
    }
    if (rules.rules.length > 6) row(`${label('')}${t.fg('dim', `… ${rules.rules.length - 6} more (lc rules show)`)}`)
    if (rules.loadError) row(`${label('')}${t.fg('error', `cannot load: ${rules.loadError}`)}`)
  } else {
    row(`${label('Rules')}${t.fg('dim', rules.history > 0 ? 'none active (rolled back or switched off)' : 'none yet — learning turns recorded output into rules')}`)
  }

  const opportunities = scan?.opportunities ?? []
  if (opportunities.length && !run?.running) {
    const max = opportunities[0]!.leftTokens
    opportunities.slice(0, 3).forEach((item, i) => {
      row(spread(`${label(i === 0 ? 'Worth learning' : '')}${truncateToWidth(item.command, 22).padEnd(22)} ${t.fg('dim', `${item.cases} outputs`)}`,
        `${t.fg('dim', `~${formatTokens(item.leftTokens)} left`)} ${t.fg('accent', bar(item.leftTokens, max, 8))}`, inner))
    })
  } else if (!run?.running) {
    row(`${label('Worth learning')}${t.fg('dim', scan ? 'nothing new yet — LightCode keeps collecting as you work' : 'looking at recorded output…')}`)
  }

  if (run && !run.running && run.outcome) {
    const good = run.outcome.result === 'adopted'
    const mark = good ? t.fg('success', '✓') : run.outcome.result === 'failed' || run.outcome.result === 'interrupted' ? t.fg('error', '✗') : t.fg('dim', '–')
    const sentence = `${outcomeSentence(run.outcome)} ${t.fg('dim', `· ${ago(run.finishedAt, data.now)}`)}`
    wrap(sentence, inner - LABEL - 2).forEach((part, i) => row(`${label(i === 0 ? 'Last run' : '')}${i === 0 ? mark : ' '} ${part}`))
  }
  for (const item of scan?.disabled ?? []) {
    wrap(`${t.fg('warning', item.id)} ${t.fg('dim', `— ${item.reason}`)}`, inner - LABEL).forEach((part, i) => row(`${label(i === 0 ? 'Switched off' : '')}${part}`))
  }
  row()

  // Actions.
  if (state.confirming === 'learn' && 'label' in data.learner) {
    row(t.fg('text', `Learn with ${t.bold(data.learner.label)}? It reads up to 40 recorded outputs from this machine,`))
    row(t.fg('text', 'sends them to that model\'s provider, and stops after 20 min. Rules are adopted only if verified.'))
    row(`${t.bold(t.fg('accent', 'y'))} ${t.fg('muted', 'start')}   ${t.bold(t.fg('accent', 'n'))} ${t.fg('muted', 'back')}`)
  } else if (state.confirming === 'rollback') {
    row(t.fg('text', 'Go back to the rules in use before the last adoption?'))
    row(`${t.bold(t.fg('accent', 'y'))} ${t.fg('muted', 'roll back')}   ${t.bold(t.fg('accent', 'n'))} ${t.fg('muted', 'back')}`)
  } else {
    if (state.message) row(t.fg(state.message.tone, state.message.text))
    else if ('unavailable' in data.learner && !run?.running) row(t.fg('dim', `Learning from here: ${data.learner.unavailable}`))
    const keys: [string, string][] = []
    if (run?.running) keys.push(['c', 'cancel'])
    else if ('label' in data.learner) keys.push(['l', 'learn now'])
    if (rules.active) keys.push(['r', 'roll back'])
    if (rules.active || rules.history > 0) keys.push(['o', rules.active ? 'rules off' : 'rules on'])
    keys.push(['esc', 'close'])
    row(keys.map(([key, text]) => `${t.bold(t.fg('accent', key))} ${t.fg('muted', text)}`).join('   '))
  }

  const border = (text: string) => t.fg('border', text)
  return [
    border(`╭${'─'.repeat(outer - 2)}╮`),
    ...lines.map(line => `${border('│')} ${pad(line, inner)} ${border('│')}`),
    border(`╰${'─'.repeat(outer - 2)}╯`),
  ]
}

/** What a key does in the panel; undefined for keys it ignores. */
export function panelKey(data: string, state: PanelState): PanelAction | 'close' | 'confirm' | 'back' | undefined {
  if (state.confirming) {
    if (data === 'y' || data === 'Y' || matchesKey(data, 'enter')) return 'confirm'
    if (data === 'n' || data === 'N' || matchesKey(data, 'escape')) return 'back'
    return undefined
  }
  if (matchesKey(data, 'escape') || data === 'q') return 'close'
  if (data === 'l') return 'learn'
  if (data === 'c') return 'cancel'
  if (data === 'r') return 'rollback'
  if (data === 'o') return 'toggle'
  return undefined
}
