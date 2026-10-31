import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { projectStaticFilter } from '../src/filters/index.ts'
import { omittedSourceRanges, sourceLines } from '../src/projection-map.ts'
import type { MappedProjection } from '../src/projection-map.ts'

/** Real outputs captured with pip 26, Yarn 1.22, npm 11 and GNU-compatible grep (paths replaced by /repo). */
const cases = JSON.parse(readFileSync(new URL('../../../conformance/economy/new-cases/search-install.json', import.meta.url), 'utf8')) as
  { id: string; command: string; stdout: string; exitCode: number }[]
const real = (id: string) => cases.find(item => item.id === id)!
const run = (command: string, stdout: string, exitCode = 0) => projectStaticFilter({ command, stdout, exitCode })

/** Every copied span is exact, and whatever is not copied is only what the note says. */
function copiedExactly(stdout: string, result: MappedProjection) {
  for (const span of result.sourceMap.spans) {
    if (span.sourceStart !== undefined) expect(result.text.slice(span.outputStart, span.outputEnd)).toBe(stdout.slice(span.sourceStart, span.sourceEnd))
  }
}

describe('search-context', () => {
  it('lists context groups of one file under one header, keeping every row, line number and separator', () => {
    const { command, stdout } = real('captured/grep-context-C2')
    const result = run(command, stdout)!
    expect(result.filter).toBe('search-context')
    copiedExactly(stdout, result)
    expect(result.text.length).toBeLessThan(stdout.length * 0.6)
    // Each original row survives without its path; the match/context mark (: or -) stays.
    for (const line of sourceLines(stdout)) {
      if (line.text === '--') continue
      const row = line.text.replace(/^src\/[\w/-]+\.ts/u, '')
      expect(result.text).toContain(`  ${row.slice(1)}`)
    }
    expect(result.text.match(/^\[lines from src\/components\/forms\/invoice-form\.ts;/gmu)).toHaveLength(1)
    expect(result.text.match(/^\[lines from src\/services\/billing\/rate-table\.ts;/gmu)).toHaveLength(1)
    // Separators: those inside a file's listing are indented, the one between the two files stays as it was.
    expect(result.text.split('\n').filter(line => line.trim() === '--')).toHaveLength(stdout.split('\n').filter(line => line === '--').length)
    // The omitted text is exactly the repeated paths and the mark after them (the header copies a block's first path).
    for (const range of omittedSourceRanges(result.sourceMap)) expect(stdout.slice(range.start, range.end)).toMatch(/^(?:src\/[\w/-]+\.ts)?[:-]$/u)
  })

  it('reads ripgrep and git grep context the same way, and leaves plain or doubtful output to the other filters', () => {
    const rows = (path: string, from: number) => [`${path}-${from}-  before`, `${path}:${from + 1}:  match`, `${path}-${from + 2}-  after`]
    const out = [...rows('pkg/service/handler.go', 10), '--', ...rows('pkg/service/handler.go', 40)].join('\n') + '\n'
    for (const command of ['rg -n -C 1 match pkg', 'git grep -n -C1 match', 'cd /repo && rg -n -C 1 match pkg | head -50']) {
      expect(run(command, out)?.filter, command).toBe('search-context')
    }
    // Plain records (no context rows) are search-layout's, unchanged.
    const plain = Array.from({ length: 5 }, (_, i) => `pkg/service/handler.go:${i + 1}:  match`).join('\n') + '\n'
    expect(run('rg -n match pkg | head', plain)?.filter).toBe('search-layout')
    // Line numbers that do not count up by one, or rows of two files in one group: not a context group.
    expect(run('rg -n -C 1 match pkg', out.replace('-12-', '-13-').replace('-42-', '-44-'))).toBeUndefined()
    expect(run('rg -n -C 1 match pkg', [...rows('pkg/a.go', 1), ...rows('pkg/b.go', 9)].join('\n') + '\n')).toBeUndefined()
    // Reading a file, not searching: left alone.
    expect(run('cat notes.txt | grep -n -C 1 match', out)).toBeUndefined()
  })
})

describe('pip-install', () => {
  it('folds transitive resolution and download rows, keeping what was named, installed and every notice', () => {
    for (const id of ['captured/pip-install-fresh', 'captured/pip-install-already-satisfied']) {
      const { command, stdout } = real(id)
      const result = run(command, stdout)!
      expect(result.filter, id).toBe('pip-install')
      copiedExactly(stdout, result)
      expect(result.text.length).toBeLessThan(stdout.length * 0.3)
      for (const line of sourceLines(stdout)) {
        const kept = !/ \(from (?!-[rc] )/u.test(line.text) && !/^\s*(?:Downloading|Using cached) /u.test(line.text) && !/^\s+━/u.test(line.text)
        if (kept && line.text !== '') expect(result.text, line.text).toContain(line.text)
      }
      expect(result.text).toMatch(/^\[\d+ dependency resolution and download lines omitted\]$/mu)
    }
    // Only requirements the user named and errors: nothing to take away.
    const error = real('captured/pip-install-requirements-error')
    expect(run(error.command, error.stdout, 1)).toBeUndefined()
  })

  it('never folds a warning or an error, and only recognizes pip itself', () => {
    const run4 = (extra: string) => ['Collecting a', ...Array.from({ length: 4 }, (_, i) => `Collecting dep${i} (from a)`), extra, ...Array.from({ length: 4 }, (_, i) => `  Using cached dep${i}-1.0-py3-none-any.whl.metadata (2 kB)`), 'Successfully installed a-1.0'].join('\n') + '\n'
    const warned = run('pip install a', run4('WARNING: dep2 1.0 does not provide the extra "x" (from a)'))!
    expect(warned.text).toContain('WARNING: dep2 1.0 does not provide the extra "x" (from a)')
    expect(warned.text.match(/omitted\]/gu)).toHaveLength(2)
    for (const command of ['pip3 install a', 'python3 -m pip install a', 'python3.12 -m pip install a', 'uv run pip install a']) expect(run(command, run4(''))?.filter, command).toBe('pip-install')
    for (const command of ['uv pip install a', 'pip download a', 'pipx install a']) expect(run(command, run4(''))?.filter, command).toBeUndefined()
    expect(run('pip install a', run4(''), 2)).toBeUndefined()
  })
})

describe('yarn-install', () => {
  it('counts the full dependency tree after the direct dependencies, keeping warnings and steps', () => {
    const { command, stdout } = real('captured/yarn-add-fresh')
    const result = run(command, stdout)!
    expect(result.filter).toBe('yarn-install')
    copiedExactly(stdout, result)
    expect(result.text).toContain('[87 installed packages omitted; the direct dependencies are listed above]')
    for (const kept of ['warning request@2.88.2: request has been deprecated', 'info Direct dependencies', '├─ express@5.3.0', 'success Saved 87 new dependencies.', 'Done in 9.34s.']) {
      expect(result.text).toContain(kept)
    }
    // Up to date, failed, or cut off before `Done in`: nothing to take away or not trusted.
    for (const id of ['captured/yarn-install-up-to-date', 'captured/yarn-add-not-found']) {
      const item = real(id)
      expect(run(item.command, item.stdout, item.exitCode), id).toBeUndefined()
    }
    expect(run(command, stdout.replace('Done in 9.34s.\n', ''))).toBeUndefined()
  })
})

describe('npm install', () => {
  it('has no filter: its output is warnings, counts, funding and audit lines the agent may need', () => {
    for (const id of ['captured/npm-install-fresh', 'captured/npm-install-up-to-date', 'captured/npm-install-not-found']) {
      const item = real(id)
      expect(run(item.command, item.stdout, item.exitCode), id).toBeUndefined()
    }
  })
})
