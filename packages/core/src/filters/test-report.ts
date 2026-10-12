import { developerCommand, isCustomNodeTestCommand, isPackageTestCommand } from '../command.ts'
import { ProjectionBuilder, sourceLines } from '../projection-map.ts'
import type { EconomyFilter, FilterInput } from '../types.ts'
import { projectCustomTestReport, resemblesCustomTestReport } from './custom-test-report.ts'

/** Complete recognized test reports. Unknown diagnostic lines and summaries are never discarded. */
function projectMapped(input: FilterInput) {
  const argv = developerCommand(input.command)
  if (!argv || ![0, 1, 101].includes(input.exitCode) || /[\u001b\0]|\r(?!\n)/.test(input.stdout)) return undefined
  if (isCustomNodeTestCommand(argv)) return projectCustomTestReport(input)
  if (resemblesCustomTestReport(input.stdout)) {
    return isPackageTestCommand(argv) ? projectCustomTestReport(input) : undefined
  }
  let passing: ((line: string) => boolean) | undefined
  let family: string | undefined
  if (argv[0] === 'cargo' && argv[1] === 'test' && !argv.some(arg => ['--nocapture', '--show-output'].includes(arg))) {
    if (!/^test result: (?:ok|FAILED)\. \d+ passed; \d+ failed;/m.test(input.stdout)) return undefined
    family = 'cargo'; passing = line => /^test [\w:]+ \.\.\. ok$/.test(line)
  } else if (argv[0] === 'go' && argv[1] === 'test' && !argv.includes('-json')) {
    if (!/^(?:ok\s+\S+\s+\S+|FAIL(?:\s|$))/m.test(input.stdout)) return undefined
    family = 'go'; passing = line => /^--- PASS: \S+ \([\d.]+s\)$/.test(line)
  } else if ((argv[0] === 'node' && argv.includes('--test'))
    || (['npm', 'pnpm', 'yarn'].includes(argv[0] ?? '') && (argv[1] === 'test' || argv[1] === 'run' && argv[2] === 'test'))) {
    if (!/^TAP version 13\r?$/m.test(input.stdout) || !/^# tests \d+\r?$/m.test(input.stdout)
      || !/^# fail \d+\r?$/m.test(input.stdout) || !/^1\.\.\d+\r?$/m.test(input.stdout)) return undefined
    family = 'TAP'; passing = line => /^ok [1-9]\d* - .+/.test(line) && !/# (?:SKIP|TODO)\b/i.test(line)
  }
  if (!passing || !family) return undefined
  const builder = new ProjectionBuilder(input.stdout)
  let count = 0
  for (const line of sourceLines(input.stdout)) {
    if (passing(line.text)) count++
    else builder.keep(line.start, line.end)
  }
  if (count < 3) return undefined
  builder.newline()
  builder.generate(`[${family}: ${count} passing-status rows omitted; other output retained]\n`, 'test-report-preview')
  return builder.finish()
}

export const testReportFilter: EconomyFilter = {
  name: 'test-report', transformation: 'preview', projectMapped,
  project: input => projectMapped(input)?.text,
}
