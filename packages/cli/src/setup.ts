/**
 * `tokenwise setup` and `tokenwise uninstall`: add TokenWise to the coding agents
 * installed on this machine, or take it out again, with each agent's own
 * plugin commands. Every command is printed before it runs.
 *
 * From a checkout (or `npm install -g ./packages/cli`, which links one) the
 * plugins come from that checkout; from the published package, the
 * marketplaces come from GitHub, pi and DeepSeek Harness from npm, and the
 * OpenCode and Hermes plugins from the files the package carries in assets/.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { onPath } from './context.ts'

export const REPOSITORY = 'Zongwei9888/tokenwise'

export interface Sources {
  /** Where Claude Code, Codex, CodeBuddy and Grok read the marketplace: a checkout or a GitHub repository. */
  readonly marketplace: string
  readonly pi: string
  readonly dsh: string
  /** The OpenCode plugin file and the Hermes plugin directory. */
  readonly opencode: string
  readonly hermes: string
}

/** A checkout when the CLI runs from one; otherwise the published sources. */
export function sources(cliFile = fileURLToPath(import.meta.url)): Sources {
  const root = join(dirname(cliFile), '..', '..', '..')
  if (existsSync(join(root, '.claude-plugin', 'marketplace.json')) && existsSync(join(root, 'adapters'))) {
    return { marketplace: root, pi: join(root, 'adapters', 'pi'), dsh: join(root, 'adapters', 'dsh'),
      opencode: join(root, 'adapters', 'opencode', 'dist', 'index.js'), hermes: join(root, 'adapters', 'hermes', 'tokenwise') }
  }
  const assets = join(dirname(cliFile), '..', 'assets')
  return { marketplace: REPOSITORY, pi: 'npm:@tokenwise/pi', dsh: '@tokenwise/dsh',
    opencode: join(assets, 'opencode', 'tokenwise.js'), hermes: join(assets, 'hermes', 'tokenwise') }
}

export type Step =
  | { readonly run: readonly string[]; readonly mayFail?: boolean }
  | { readonly copy: string; readonly to: string }
  | { readonly remove: string }

export interface Options { readonly dshProfile: string; readonly env: NodeJS.ProcessEnv }

interface Agent {
  readonly id: string
  readonly name: string
  readonly bin: string
  install(s: Sources, o: Options): Step[]
  uninstall(s: Sources, o: Options): Step[]
  /** What is left for the user to do after installing. */
  readonly next?: string
}

const opencodeFile = (env: NodeJS.ProcessEnv) => join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config'), 'opencode', 'plugins', 'tokenwise.js')
const hermesDir = (env: NodeJS.ProcessEnv) => join(env.HERMES_HOME || join(env.HOME || homedir(), '.hermes'), 'plugins', 'tokenwise')

/** Claude Code, Codex, CodeBuddy and Grok: a marketplace named tokenwise, then the plugin from it. Adding it again fails harmlessly. */
const marketplace = (bin: string, add: string[], remove: string[]): Pick<Agent, 'install' | 'uninstall'> => ({
  install: s => [{ run: [bin, 'plugin', 'marketplace', 'add', s.marketplace], mayFail: true }, { run: [bin, 'plugin', ...add] }],
  uninstall: () => [{ run: [bin, 'plugin', ...remove] }, { run: [bin, 'plugin', 'marketplace', 'remove', 'tokenwise'], mayFail: true }],
})

export const AGENTS: readonly Agent[] = [
  { id: 'pi', name: 'pi', bin: 'pi',
    install: s => [{ run: ['pi', 'install', s.pi] }], uninstall: s => [{ run: ['pi', 'remove', s.pi] }] },
  { id: 'dsh', name: 'DeepSeek Harness', bin: 'dsh',
    install: (s, o) => [{ run: ['dsh', 'plugin', '--profile', o.dshProfile, 'add', s.dsh] }],
    uninstall: (_, o) => [{ run: ['dsh', 'plugin', '--profile', o.dshProfile, 'remove', '@tokenwise/dsh'] }] },
  { id: 'claude', name: 'Claude Code', bin: 'claude', ...marketplace('claude', ['install', 'tokenwise@tokenwise'], ['uninstall', 'tokenwise@tokenwise']) },
  { id: 'codex', name: 'Codex', bin: 'codex', ...marketplace('codex', ['add', 'tokenwise@tokenwise'], ['remove', 'tokenwise@tokenwise']),
    next: 'Open Codex and trust the TokenWise hooks in /hooks.' },
  { id: 'codebuddy', name: 'CodeBuddy', bin: 'codebuddy', ...marketplace('codebuddy', ['install', 'tokenwise@tokenwise'], ['uninstall', 'tokenwise@tokenwise']) },
  { id: 'grok', name: 'Grok Build', bin: 'grok', ...marketplace('grok', ['install', 'tokenwise@tokenwise', '--trust'], ['uninstall', 'tokenwise']) },
  { id: 'opencode', name: 'OpenCode', bin: 'opencode',
    install: (s, o) => [{ copy: s.opencode, to: opencodeFile(o.env) }], uninstall: (_, o) => [{ remove: opencodeFile(o.env) }] },
  { id: 'hermes', name: 'Hermes Agent', bin: 'hermes',
    install: (s, o) => [{ copy: s.hermes, to: hermesDir(o.env) }, { run: ['hermes', 'plugins', 'enable', 'tokenwise'] },
      { run: ['hermes', 'config', 'set', 'context.engine', 'tokenwise'] }],
    uninstall: (_, o) => [{ run: ['hermes', 'config', 'set', 'context.engine', 'compressor'], mayFail: true },
      { run: ['hermes', 'plugins', 'disable', 'tokenwise'], mayFail: true }, { remove: hermesDir(o.env) }] },
]

export function describeStep(step: Step): string {
  if ('run' in step) return step.run.map(arg => /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`).join(' ')
  if ('copy' in step) return `copy ${step.copy} -> ${step.to}`
  return `remove ${step.remove}`
}

/** Run one step; true when it worked (or may fail). */
function perform(step: Step, env: NodeJS.ProcessEnv): boolean {
  try {
    if ('run' in step) {
      const result = spawnSync(step.run[0]!, step.run.slice(1), { stdio: 'inherit', env })
      return result.status === 0 || step.mayFail === true
    }
    if ('copy' in step) {
      if (!existsSync(step.copy)) { process.stderr.write(`  missing ${step.copy} (run pnpm build in the checkout)\n`); return false }
      mkdirSync(dirname(step.to), { recursive: true })
      cpSync(step.copy, step.to, { recursive: true, force: true })
      return true
    }
    rmSync(step.remove, { recursive: true, force: true })
    return true
  } catch (error) {
    process.stderr.write(`  ${(error as Error).message}\n`)
    return false
  }
}

export interface SetupArgs {
  readonly action: 'setup' | 'uninstall'
  /** Agent ids; empty means every agent found on PATH. */
  readonly agents: readonly string[]
  readonly dryRun?: boolean
  /** uninstall only: also delete the TokenWise data directory. */
  readonly purge?: string
  readonly dshProfile?: string
  readonly env?: NodeJS.ProcessEnv
  readonly sources?: Sources
  readonly perform?: (step: Step, env: NodeJS.ProcessEnv) => boolean
}

export function setup(args: SetupArgs): number {
  const env = args.env ?? process.env
  const unknown = args.agents.filter(id => !AGENTS.some(agent => agent.id === id))
  if (unknown.length) {
    process.stderr.write(`tokenwise ${args.action}: unknown agent ${unknown.join(', ')} (one of ${AGENTS.map(agent => agent.id).join(', ')})\n`)
    return 2
  }
  const chosen = args.agents.length ? AGENTS.filter(agent => args.agents.includes(agent.id)) : AGENTS.filter(agent => onPath(agent.bin, env))
  if (!chosen.length && !args.purge) {
    process.stdout.write(`No supported agent found on PATH (${AGENTS.map(agent => agent.bin).join(', ')}). Name one: tokenwise ${args.action} <agent>\n`)
    return 1
  }
  const s = args.sources ?? sources()
  const options: Options = { dshProfile: args.dshProfile ?? 'web', env }
  const run = args.perform ?? perform
  const failed: string[] = []
  const next: string[] = []
  for (const agent of chosen) {
    process.stdout.write(`\n${agent.name}\n`)
    let ok = true
    for (const step of args.action === 'setup' ? agent.install(s, options) : agent.uninstall(s, options)) {
      process.stdout.write(`  $ ${describeStep(step)}\n`)
      if (!args.dryRun && !run(step, env)) { ok = false; break }
    }
    if (!ok) failed.push(agent.name)
    else if (args.action === 'setup' && agent.next) next.push(`${agent.name}: ${agent.next}`)
  }
  if (args.purge) {
    process.stdout.write(`\nTokenWise data\n  $ ${describeStep({ remove: args.purge })}\n`)
    if (!args.dryRun && !run({ remove: args.purge }, env)) failed.push('TokenWise data')
  }
  if (args.dryRun) { process.stdout.write('\nDry run: nothing was changed.\n'); return 0 }
  const done = chosen.map(agent => agent.name).filter(name => !failed.includes(name))
  if (done.length) process.stdout.write(`\n${args.action === 'setup' ? 'TokenWise is set up for' : 'TokenWise was removed from'} ${done.join(', ')}.\n`)
  for (const line of next) process.stdout.write(`${line}\n`)
  if (failed.length) process.stderr.write(`Did not finish: ${failed.join(', ')} (see the output above).\n`)
  return failed.length ? 1 : 0
}
