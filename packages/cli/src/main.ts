import { parseArgs } from 'node:util'
import { economyCoverage, economyRuleDisplayName } from '@lightcode/core'
import type { EconomyFilterName } from '@lightcode/core'
import { FileArtifactStore } from '@lightcode/store'
import { cliContext } from './context.ts'
import { doctor, VERSION } from './doctor.ts'
import { evolve, evolveCheck, evolveTry, rules } from './evolve.ts'
import { hook } from './hook.ts'
import { report } from './report.ts'
import { run } from './run.ts'

const HELP = `lc — LightCode ${VERSION}

Usage:
  lc run [--host H] [--session S] [--call C] -c <script>   run a shell script, print filtered output
  lc run [--host H] [--session S] [--call C] -- <program> [args...]
  lc hook codex                    Codex hook handler (reads hook JSON on stdin)
  lc report [--host H] [--session S] [--json]
  lc filters [--json]              list output filters and what each preserves
  lc show <sha256>                 print a saved original output
  lc gc [--days N]                 delete saved originals older than N days
  lc doctor [--json]               configuration and per-host capability negotiation
  lc evolve --learner pi|dsh|claude|codex|"<command>" [--since 7d] [--max-cases N] [--timeout 30m] [--dry-run] [--json]
                                   learn output rules from recorded evidence; adopt them only if verified
  lc rules [list|show|path|off|rollback] [--json]
                                   learned rules: what is adopted, switch off, go back
  lc --version

Data: $LIGHTCODE_HOME or ~/.lightcode.  Disable: LIGHTCODE_DISABLE=1 or LIGHTCODE_ECONOMY=off.
`

function runArgs(argv: string[]) {
  const split = argv.indexOf('--')
  const head = split < 0 ? argv : argv.slice(0, split)
  const { values } = parseArgs({ args: head, strict: true, options: {
    host: { type: 'string' }, session: { type: 'string' }, call: { type: 'string' }, tool: { type: 'string' }, c: { type: 'string', short: 'c' },
  } })
  const env = process.env
  const host = values.host ?? env.LIGHTCODE_HOST ?? 'shell'
  return {
    host,
    sessionId: values.session ?? env.LIGHTCODE_SESSION ?? null,
    callId: values.call ?? null,
    // Name the host's own shell tool so decisions line up with the hook's rewrite records.
    tool: values.tool ?? (host === 'codex' ? 'exec_command' : 'bash'),
    ...values.c !== undefined ? { script: values.c } : {},
    ...split >= 0 ? { argv: argv.slice(split + 1) } : {},
  }
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  switch (command) {
    case 'run': {
      let options
      try { options = runArgs(rest) } catch (error) {
        process.stderr.write(`lc run: ${(error as Error).message}\n`)
        return 2
      }
      if ((options.script === undefined) === (options.argv === undefined)) {
        process.stderr.write('lc run: give exactly one of -c <script> or -- <program> [args...]\n')
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
      if (text === undefined) { process.stderr.write('lc show: no saved original with that sha256 (expired or never stored)\n'); return 1 }
      process.stdout.write(text)
      return 0
    }
    case 'gc': {
      const { values } = parseArgs({ args: rest, options: { days: { type: 'string' } } })
      const context = cliContext()
      const days = values.days === undefined ? context.loaded.config.artifacts.retentionDays : Number(values.days)
      if (!Number.isFinite(days) || days < 0) { process.stderr.write('lc gc: --days must be a non-negative number\n'); return 2 }
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
      if (maxCases !== undefined && (!Number.isSafeInteger(maxCases) || maxCases < 1)) { process.stderr.write('lc evolve: --max-cases must be a positive integer\n'); return 2 }
      return evolve({ ...values.learner === undefined ? {} : { learner: values.learner }, ...values.profile === undefined ? {} : { profile: values.profile },
        ...values.since === undefined ? {} : { since: values.since }, ...maxCases === undefined ? {} : { maxCases },
        ...values.timeout === undefined ? {} : { timeout: values.timeout }, dryRun: values['dry-run'] === true, json: values.json === true })
    }
    case 'rules': return rules(rest.find(arg => !arg.startsWith('-')), rest.includes('--json'))
    case '--version': case '-v': case 'version': process.stdout.write(`${VERSION}\n`); return 0
    case undefined: case '--help': case '-h': case 'help': process.stdout.write(HELP); return 0
    default:
      process.stderr.write(`lc: unknown command ${command}\n${HELP}`)
      return 2
  }
}

const code = await main(process.argv.slice(2))
process.exitCode = code
