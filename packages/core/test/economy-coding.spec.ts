import { describe, expect, it } from 'vitest'
import { projectStaticFilter, tscFilter, eslintJsonFilter, viteBuildFilter, pnpmInstallFilter } from '../src/filters/index.ts'
import { omittedSourceRanges } from '../src/projection-map.ts'
import { codingOutputCases } from './economy-fixtures.ts'

describe('Coding output filters and exact evidence', () => {
  it.each(codingOutputCases)('$filter reduces its supported report and accounts for every source character', fixture => {
    const projection = projectStaticFilter(fixture)!
    expect(projection?.filter).toBe(fixture.filter)
    expect(projection.text.length).toBeLessThan(fixture.stdout.length)
    expect(projection.text).toContain(fixture.required)
    let outputEnd = 0
    const ranges: { start: number; end: number }[] = [...omittedSourceRanges(projection.sourceMap)]
    for (const span of projection.sourceMap.spans) {
      expect(span.outputStart).toBe(outputEnd)
      outputEnd = span.outputEnd
      if (span.sourceStart !== undefined && span.sourceEnd !== undefined) {
        expect(projection.text.slice(span.outputStart, span.outputEnd)).toBe(fixture.stdout.slice(span.sourceStart, span.sourceEnd))
        ranges.push({ start: span.sourceStart, end: span.sourceEnd })
      } else expect(span.generated).toBeTruthy()
    }
    expect(outputEnd).toBe(projection.text.length)
    let sourceEnd = 0
    for (const range of ranges.sort((a, b) => a.start - b.start)) {
      expect(range.start).toBe(sourceEnd)
      sourceEnd = range.end
    }
    expect(sourceEnd).toBe(fixture.stdout.length)
  })

  it.each(codingOutputCases)('$filter respects its command/output boundary and rejects abnormal exit', fixture => {
    for (const command of [`echo important; ${fixture.command}`, `${fixture.command} | sort`, `npm run ${fixture.filter}`]) {
      const layout = ['search-layout', 'path-list', 'ls-listing'].includes(fixture.filter) && !command.startsWith('npm run ')
      const result = projectStaticFilter({ ...fixture, command })
      if (layout) {
        expect(result?.filter).toBe(fixture.filter)
        expect(result?.text).toContain(fixture.required)
      } else expect(result).toBeUndefined()
    }
    expect(projectStaticFilter({ ...fixture, stdout: 'unexpected output\n' })).toBeUndefined()
    expect(projectStaticFilter({ ...fixture, exitCode: 130 })).toBeUndefined()
  })

  it('never deduplicates equal TS headlines with different diagnostic chains or intervening notes', () => {
    const headline = 'src/a.ts(2,3): error TS2322: Type mismatch.\n'
    const stdout = headline + '  Expected A.\n' + headline + '  Expected B.\n' +
      'PLUGIN: important explanation without an error keyword\n' + headline
    expect(tscFilter.project({ command: 'tsc', stdout, exitCode: 2 })).toBe(stdout)
    expect(tscFilter.project({ command: 'tsc', stdout, exitCode: 0 })).toBeUndefined()
    expect(tscFilter.project({ command: 'tsc --watch', stdout, exitCode: 2 })).toBeUndefined()
    expect(tscFilter.project(codingOutputCases.find(item => item.filter === 'tsc')!)).toContain('repeated 30 times consecutively')
  })

  it('ESLint keeps every JSON value, source, fix, unknown field and escaped character', () => {
    const fixture = codingOutputCases.find(item => item.filter === 'eslint-json')!
    const projection = eslintJsonFilter.projectMapped(fixture)!
    expect(JSON.parse(projection.text)).toEqual(JSON.parse(fixture.stdout))
    expect(projection.text).toContain('a  b')
    expect(projection.sourceMap.spans.every(span => span.generated === undefined)).toBe(true)
    for (const range of omittedSourceRanges(projection.sourceMap)) {
      expect(fixture.stdout.slice(range.start, range.end)).toMatch(/^[ \r\n\t]+$/)
    }
    expect(eslintJsonFilter.project({ ...fixture, command: 'eslint -f stylish src/' })).toBeUndefined()
    expect(eslintJsonFilter.project({ ...fixture, stdout: fixture.stdout + '\nwrapper failed' })).toBeUndefined()
  })

  it('ESLint preserves duplicate keys and numeric spellings instead of parsing and reserializing', () => {
    const stdout = '[ { "filePath": "a", "messages": [], "errorCount": 0, "warningCount": 0, "extra": 1e3, "extra": 1000 } ]'
    expect(eslintJsonFilter.project({ command: 'eslint --format=json', stdout, exitCode: 0 }))
      .toBe('[{"filePath":"a","messages":[],"errorCount":0,"warningCount":0,"extra":1e3,"extra":1000}]')
  })

  it('Vite preserves every asset and its size, warnings and completion time', () => {
    const fixture = codingOutputCases.find(item => item.filter === 'vite-build')!
    const output = viteBuildFilter.project(fixture)!
    expect(output.match(/dist\/assets\/chunk\d+\.js/g)).toHaveLength(40)
    expect(output.match(/12\.34 kB/g)).toHaveLength(40)
    expect(output).toContain('✓ 250 modules transformed.')
    expect(output).toContain('✓ built in 1.20s')
    expect(viteBuildFilter.project({ ...fixture, stdout: fixture.stdout.replace('✓ built in 1.20s\n', '') })).toBeUndefined()
    expect(viteBuildFilter.project({ ...fixture, exitCode: 1 })).toBeUndefined()
  })

  it('pnpm keeps progress resets, diagnostic boundaries, scripts and dependency changes', () => {
    const stdout = 'Progress: resolved 10, reused 0, downloaded 10, added 10\n' +
      'Progress: resolved 1, reused 0, downloaded 1, added 1\n' +
      'WARN important\n> postinstall: generated configuration\n+ dependency 1.0.0\n' +
      'Progress: resolved 2, reused 0, downloaded 2, added 2, done\nDone in 1s\n'
    expect(pnpmInstallFilter.project({ command: 'pnpm install', stdout, exitCode: 0 })).toBe(stdout)
    const fixture = codingOutputCases.find(item => item.filter === 'pnpm-install')!
    expect(pnpmInstallFilter.project({ ...fixture, exitCode: 1 })).toBeUndefined()
    expect(pnpmInstallFilter.project({ ...fixture, stdout: 'Progress: resolved 2, reused 0, downloaded 2, added 2\n' })).toBeUndefined()
  })
})
