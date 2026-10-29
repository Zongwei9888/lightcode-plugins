import { parseArgs } from 'node:util'
import { economyCoverage, economyRuleDisplayName } from '@tokenwise/core'
import type { EconomyFilterName } from '@tokenwise/core'
import { FileArtifactStore } from '@tokenwise/store'
import { cliContext } from './context.ts'
import { doctor, VERSION } from './doctor.ts'
import { evolve, evolveCheck, evolveTry, rules } from './evolve.ts'
import { hook } from './hook.ts'
import { mcp } from './mcp.ts'
import { report } from './report.ts'
import { run } from './run.ts'
import { recall, shadow } from './shadow.ts'

const HELP = `tokenwise — TokenWise ${VERSION}

Usage:
  tokenwise run [--host H] [--session S] [--call C] -c <script>   run a shell script, print filtered output
  tokenwise run [--host H] [--session S] [--call C] -- <program> [args...]
  tokenwise hook codex|claude|codebuddy|grok|hermes
                                   hook handler for that host (reads hook JSON on stdin)
  tokenwise report [--host H] [--session S] [--json]
  tokenwise filters [--json]              list output filters and what each preserves
  tokenwise show <sha256>                 print a saved original output
  tokenwise gc [--days N]                 delete saved originals older than N days
  tokenwise doctor [--json]               configuration and per-host capability negotiation
  tokenwise evolve --learner pi|dsh|claude|codex|"<command>" [--since 7d] [--max-cases N] [--timeout 30m] [--dry-run] [--json]
                                   learn output rules from recorded evidence; adopt them only if verified
  tokenwise rules [list|show|path|off|on|rollback] [--json]
                                   learned rules: what is adopted, switch off, go back
  tokenwise recall <observation_id> [--query Q | --line N] [--original] [--session S]
                                   read again a tool result LightShadow kept
  tokenwise mcp [--host H] [--session S]  MCP server (stdio) offering the tokenwise_recall tool
  tokenwise shadow instruction|tool|checkpoint|catalog
                                   LightShadow for host adapters (JSON on stdin and stdout)
  tokenwise --version

Data: $TOKENWISE_HOME or ~/.tokenwise.  Disable: TOKENWISE_DISABLE=1 or TOKENWISE_OUTPUT=off.
`

function runArgs(argv: string[]) {
  const split = argv.indexOf('--')
  const head = split < 0 ? argv : argv.slice(0, split)
  const { values } = parseArgs({ args: head, strict: true, options: {
    host: { type: 'string' }, session: { type: 'string' }, call: { type: 'string' }, tool: { type: 'string' }, c: { type: 'string', short: 'c' },
  } })
  const env = process.env
  const host = values.host ?? env.TOKENWISE_HOST ?? 'shell'
  return {
    host,
    sessionId: values.session ?? env.TOKENWISE_SESSION ?? null,
    callId: values.call ?? null,
    // Name the host's own shell tool so decisions line up with the hook's rewrite records.
    tool: values.tool ?? (host === 'codex' ? 'exec_command' : 'bash'),
    ...values.c !== undefined ? { script: values.c } : {},
    ...split >= 0 ? { argv: argv.slice(split + 1) } : {},
  }
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  // `tokenwise <command> --help` prints the usage. `tokenwise run` and `tokenwise hook` pass their arguments on, so theirs are never read as a request for help.
  if (command !== 'run' && command !== 'hook' && (rest.includes('--help') || rest.includes('-h'))) { process.stdout.write(HELP); return 0 }
  try {
    return await dispatch(command, rest)
  } catch (error) {
    // An unknown or malformed option: one line, not a stack trace.
    if (!String((error as NodeJS.ErrnoException).code ?? '').startsWith('ERR_PARSE_ARGS_')) throw error
    process.stderr.write(`tokenwise ${command}: ${(error as Error).message}\nRun \`tokenwise --help\` for usage.\n`)
    return 2
  }
}

async function dispatch(command: string | undefined, rest: string[]): Promise<number> {
  switch (command) {
    case 'run': {
      let options
      try { options = runArgs(rest) } catch (error) {
        process.stderr.write(`tokenwise run: ${(error as Error).message}\n`)
        return 2
      }
      if ((options.script === undefined) === (options.argv === undefined)) {
        process.stderr.write('tokenwise run: give exactly one of -c <script> or -- <program> [args...]\n')
        return 2
      }
      return run(options)
    }
    case 'hook': return hook(rest[0])
    case 'report': {
      const { values } = parseArgs({ args: rest, options: { host: { type: 'string' }, session: { type: 'string' }, json: { type: 'boolean' } } })
      return report({ ...values.host === undefined ? {} : { host: values.host }, ...values.session === undefined ? {} : { session: values.session }, json: values.json === true })
    }
    case 'filters': {
      const coverage = economyCoverage()
      if (rest.includes('--json')) { process.stdout.write(JSON.stringify(coverage, null, 2) + '\n'); return 0 }
      for (const filter of coverage.filters) {
        process.stdout.write(`${economyRuleDisplayName(filter.name as EconomyFilterName).padEnd(20)} ${filter.transformation.padEnd(24)} ${filter.action}\n`)
      }
      return 0
    }
    case 'show': {
      const text = rest[0] ? cliContext().readArtifact(rest[0]) : undefined
      if (text === undefined) { process.stderr.write('tokenwise show: no saved original with that sha256 (expired or never stored)\n'); return 1 }
      process.stdout.write(text)
      return 0
    }
    case 'gc': {
      const { values } = parseArgs({ args: rest, options: { days: { type: 'string' } } })
      const context = cliContext()
      const days = values.days === undefined ? context.loaded.config.artifacts.retentionDays : Number(values.days)
      if (!Number.isFinite(days) || days < 0) { process.stderr.write('tokenwise gc: --days must be a non-negative number\n'); return 2 }
      const removed = context.dataDirs.reduce((sum, dir) => sum + new FileArtifactStore(dir).prune(days), 0)
      process.stdout.write(`removed ${removed} saved originals older than ${days} days\n`)
      return 0
    }
    case 'doctor': return doctor({ json: rest.includes('--json') })
    case 'evolve': {
      if (rest[0] === 'check' || rest[0] === 'try') {
        const { values, positionals } = parseArgs({ args: rest.slice(1), allowPositionals: true, options: { workspace: { type: 'string' }, json: { type: 'boolean' } } })
        return rest[0] === 'check' ? evolveCheck(values.workspace, values.json === true) : evolveTry(values.workspace, positionals[0])
      }
      const { values } = parseArgs({ args: rest, options: {
        learner: { type: 'string' }, profile: { type: 'string' }, since: { type: 'string' }, 'max-cases': { type: 'string' },
        timeout: { type: 'string' }, 'dry-run': { type: 'boolean' }, json: { type: 'boolean' },
      } })
      const maxCases = values['max-cases'] === undefined ? undefined : Number(values['max-cases'])
      if (maxCases !== undefined && (!Number.isSafeInteger(maxCases) || maxCases < 1)) { process.stderr.write('tokenwise evolve: --max-cases must be a positive integer\n'); return 2 }
      return evolve({ ...values.learner === undefined ? {} : { learner: values.learner }, ...values.profile === undefined ? {} : { profile: values.profile },
        ...values.since === undefined ? {} : { since: values.since }, ...maxCases === undefined ? {} : { maxCases },
        ...values.timeout === undefined ? {} : { timeout: values.timeout }, dryRun: values['dry-run'] === true, json: values.json === true })
    }
    case 'rules': return rules(rest.find(arg => !arg.startsWith('-')), rest.includes('--json'))
    case 'recall': {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: {
        query: { type: 'string' }, line: { type: 'string' }, original: { type: 'boolean' }, host: { type: 'string' }, session: { type: 'string' }, call: { type: 'string' },
      } })
      return recall({ id: positionals[0], ...values.query === undefined ? {} : { query: values.query }, ...values.line === undefined ? {} : { line: values.line },
        original: values.original === true, ...values.host === undefined ? {} : { host: values.host },
        ...values.session === undefined ? {} : { session: values.session }, ...values.call === undefined ? {} : { call: values.call } })
    }
    case 'mcp': {
      const { values } = parseArgs({ args: rest, options: { host: { type: 'string' }, session: { type: 'string' } } })
      return mcp({ ...values.host === undefined ? {} : { host: values.host }, ...values.session === undefined ? {} : { session: values.session } })
    }
    case 'shadow': return shadow(rest[0])
    case '--version': case '-v': case 'version': process.stdout.write(`${VERSION}\n`); return 0
    case undefined: case '--help': case '-h': case 'help': process.stdout.write(HELP); return 0
    default:
      process.stderr.write(`tokenwise: unknown command ${command}\n${HELP}`)
      return 2
  }
}

const code = await main(process.argv.slice(2))
process.exitCode = code
