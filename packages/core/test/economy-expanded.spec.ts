import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { projectStaticFilter } from '../src/filters/index.ts'

const ruffReport = [{ filename: '/src/甲.py', code: 'F401', message: 'unused import', location: { row: 1, column: 1 },
  fix: { edits: [{ content: '', location: { row: 1, column: 1 } }] }, future: { text: 'keep \\" quoted\n text' } }]

describe('additional Git, Python diagnostics and Go test output contracts', () => {
  it('compacts Ruff layout without deleting findings, fixes, new fields, duplicate keys or numeric spelling', () => {
    const raw = JSON.stringify(ruffReport, null, 4).replace('"code": "F401"', '"number": 1e+20, "code": "first", "code": "F401"')
    const projected = projectStaticFilter({ command: 'uv run ruff check --output-format=json src', stdout: raw, exitCode: 1 })!
    expect(projected.filter).toBe('ruff-json')
    expect(JSON.parse(projected.text)).toEqual(JSON.parse(raw))
    expect(projected.text).toContain('"number":1e+20,"code":"first","code":"F401"')
    expect(projected.text.length).toBeLessThan(raw.length)
    for (const span of projected.sourceMap.spans) expect(projected.text.slice(span.outputStart, span.outputEnd)).toBe(raw.slice(span.sourceStart, span.sourceEnd))
  })

  it.each(['ruff check src', 'ruff format --output-format=json src', 'ruff check --output-format=json --output-format=full src', 'ruff check --output-format=json src && true'])('does not infer JSON command formats: %s', command => {
    expect(projectStaticFilter({ command, stdout: JSON.stringify(ruffReport, null, 2), exitCode: 1 })).toBeUndefined()
  })

  it('preserves every Go event and exact escaped test-output string in order', () => {
    const raw = '{ "Action": "run", "Package": "example/p", "Test": "TestA" }\r\n'
      + '{ "Action": "output", "Package": "example/p", "Output": "  error\\n  diagnostics  ", "Future": 1e+20 }\r\n'
      + '{ "Action": "fail", "Package": "example/p", "Elapsed": 0.03 }\r\n'
    const projection = projectStaticFilter({ command: 'go test -json ./...', stdout: raw, exitCode: 1 })!
    expect(projection.filter).toBe('go-test-json')
    expect(projection.text.split('\r\n').filter(Boolean).map(line => JSON.parse(line))).toEqual(raw.split('\r\n').filter(Boolean).map(line => JSON.parse(line)))
    expect(projection.text).toContain('"Output":"  error\\n  diagnostics  "')
    expect(projection.text).toContain('1e+20')
    expect(projection.text.match(/\r\n/g)).toHaveLength(3)
  })

  it.each(['not JSON', '{"Action":"unknown","Package":"p"}\n', '{"Action":"pass","Package":"p"}\ncompiler diagnostic\n'])('keeps unknown or mixed Go output: %s', stdout => {
    expect(projectStaticFilter({ command: 'go test -json ./...', stdout, exitCode: 1 })).toBeUndefined()
  })

  it('does not pretend already compact Go JSON can save tokens', () => {
    const raw = '{"Action":"pass","Package":"p"}\n'
    expect(projectStaticFilter({ command: 'go test -json ./...', stdout: raw, exitCode: 0 })?.text).toBe(raw)
  })

  it('filters real Git status hints while preserving every other byte, including tricky filenames', async () => {
    const root = await mkdtemp(join(tmpdir(), 'economy-git-status-'))
    const git = (args: string[]) => execFileSync('git', ['-c', 'color.ui=false', '-c', 'advice.statusHints=true', ...args],
      { cwd: root, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1' } })
    try {
      git(['init', '-q', '--initial-branch=main'])
      await writeFile(join(root, 'tracked.txt'), 'initial')
      git(['add', 'tracked.txt'])
      await writeFile(join(root, 'tracked.txt'), 'modified')
      await writeFile(join(root, 'Line 25: strange name.txt'), 'untracked')
      const raw = git(['status', '--long'])
      const projection = projectStaticFilter({ command: 'git status --long', stdout: raw, exitCode: 0 })!
      expect(projection.filter).toBe('git-status')
      expect(projection.text).toContain('tracked.txt')
      expect(projection.text).toContain('Line 25: strange name.txt')
      expect(projection.text).toContain('Changes to be committed:')
      expect(projection.text).toContain('Changes not staged for commit:')
      const removed = raw.split('\n').filter(line => !projection.text.split('\n').includes(line))
      expect(removed.length).toBeGreaterThan(0)
      expect(removed.every(line => line.startsWith('  (use "git '))).toBe(true)
      expect(projectStaticFilter({ command: 'git status --porcelain=v1', stdout: git(['status', '--porcelain=v1']), exitCode: 0 })).toBeUndefined()
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
