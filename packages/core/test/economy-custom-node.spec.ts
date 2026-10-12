import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { projectStaticFilter } from '../src/filters/index.ts'
import { projectCustomTestReport } from '../src/filters/custom-test-report.ts'
import { hasBuiltinCommand } from '../src/shell-inspection.ts'

// Exact user-project stdout and stderr from a prior unfiltered live run.
const recorded = JSON.parse(readFileSync(new URL('./fixtures/custom-node-recorded.json', import.meta.url), 'utf8')) as {
  command: string; stdout: string; stderr: string; raw: string; exitCode: number;
}[]
const passing = (count: number) => Array.from({ length: count }, (_, i) => `  ✓ assertion ${i} 中文😀\n`).join('')
const report = (failed = 0) => '■ suite\n' + passing(20)
  + (failed ? '  ✗ expected 42, got 0\n    stack: app.js:17\n' : '')
  + `测试完成：20 通过，${failed} 失败\n`
  + (failed ? '\n失败清单：\n  ✗ expected 42, got 0\n    stack: app.js:17\n' : '全部通过 ✓\n')
const input = (stdout: string, exitCode = 0) => ({ command: 'node test/run-tests.mjs', stdout, exitCode })

describe('counted custom Node assertion reports', () => {
  it('filters the real npm wrapper without losing its preamble or failure evidence', () => {
    const result = spawnSync('npm', ['test', '--logs-max=0'], {
      cwd: new URL('./fixtures/custom-node-package/', import.meta.url), encoding: 'utf8', timeout: 10_000,
    })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('> node ../custom-node-failure.mjs')
    expect(result.stderr).toContain('stderr diagnostic must survive')
    const output = projectStaticFilter({ command: 'npm test --logs-max=0', stdout: result.stdout, exitCode: 1 })!
    expect(output.filter).toBe('test-report')
    expect(output.text).toContain('> node ../custom-node-failure.mjs')
    expect(output.text).toContain('测试完成：40 通过，1 失败')
    expect(output.text).toContain('失败清单：\n  ✗ necessary failure detail: expected 2, got 1')
    expect(output.text.length).toBeLessThan(result.stdout.length)
    for (const span of output.sourceMap.spans) if (span.sourceStart !== undefined) {
      expect(output.text.slice(span.outputStart, span.outputEnd)).toBe(result.stdout.slice(span.sourceStart, span.sourceEnd))
    }
  })
  it.each(['npm test', 'npm run test --logs-max=0', 'pnpm test', 'yarn run test', 'bun test'])
    ('validates counted success and failure reports through %s', command => {
      for (const exitCode of [0, 1]) {
        const stdout = '\n> fixture@1.0.0 test\n> node test/run-tests.mjs\n\n' + report(exitCode)
        const output = projectStaticFilter({ command, stdout, exitCode })!
        expect(output.filter).toBe('test-report')
        expect(output.text).toContain(`测试完成：20 通过，${exitCode} 失败`)
        expect(output.text).toContain('> fixture@1.0.0 test')
      }
    })
  it.each([
    report().replace('20 通过', '19 通过'), report().replace('全部通过 ✓\n', ''),
    report(1), report() + report(), report() + 'unknown trailer\n',
    '■ suite\n' + passing(20), report().replace('测试完成：', '测试完成：broken'),
  ])('does not fall back to generic positive-row filtering for malformed npm reports (%#)', stdout => {
    expect(projectStaticFilter({ command: 'npm test', stdout, exitCode: 0 })).toBeUndefined()
  })
  it.each(['npm test -- --watch', 'npm test --workspace=other', 'npm test --unknown',
    'npm test | tail -20', 'npm test; echo done', 'npm run build'])
    ('keeps custom reports verbatim for unsupported package commands: %s', command => {
      expect(projectStaticFilter({ command, stdout: report(), exitCode: 0 })).toBeUndefined()
    })
  it('filters a real failing Node process and keeps its failure summary', () => {
    const result = spawnSync(process.execPath, ['test/fixtures/custom-node-failure.mjs'], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('stderr diagnostic must survive')
    const output = projectStaticFilter({ command: 'node test/fixtures/custom-node-failure.mjs', stdout: result.stdout, exitCode: result.status! })!
    expect(output.filter).toBe('test-report')
    expect(output.text).toContain('necessary failure detail: expected 2, got 1')
    expect(output.text).toContain('测试完成：40 通过，1 失败')
    expect(output.text.length).toBeLessThan(result.stdout.length)
  })
  it.each(recorded)('recognizes real $command without guessing script source', fixture => {
    expect(hasBuiltinCommand(fixture.command)).toBe(true)
    const output = projectStaticFilter(fixture)!
    expect(output.filter).toBe('test-report')
    if (fixture.command.includes('weighted-pick')) expect(output.text).toBe(fixture.stdout)
    else {
      expect(output.text.length).toBeLessThan(fixture.stdout.length)
      expect(output.text).toContain('positive-status rows condensed')
      expect(output.text).not.toMatch(/recover|full original/i)
      const summary = fixture.command.includes('cooldown') ? '通过: 46\n失败: 0' : '测试完成：389 通过，0 失败'
      expect(output.text).toContain(summary)
      for (const line of fixture.stdout.split('\n').filter(line => line.startsWith('■ '))) expect(output.text).toContain(line)
    }
    for (const span of output.sourceMap.spans) if (span.sourceStart !== undefined) {
      expect(output.text.slice(span.outputStart, span.outputEnd)).toBe(fixture.stdout.slice(span.sourceStart, span.sourceEnd))
    }
    expect(output.sourceMap.sourceLength).toBe(fixture.stdout.length)
  })
  it('preserves all failure details, custom diagnostics, section labels and the actual summary', () => {
    const raw = report(1).replace('测试完成', 'diagnostic: DO NOT DROP\n测试完成')
    const output = projectCustomTestReport(input(raw, 1))!
    expect(output.text).toContain('expected 42, got 0\n    stack: app.js:17')
    expect(output.text).toContain('diagnostic: DO NOT DROP')
    expect(output.text).toContain('测试完成：20 通过，1 失败')
    expect(output.text).toContain('失败清单：')
    expect(output.text).not.toContain('全部通过')
    expect(output.text.length).toBeLessThan(raw.length)
  })
  it('keeps passing-looking lines within opaque failure details unchanged', () => {
    const raw = report(1) + '    ✓ diagnostic evidence, not a status row\n'
    expect(projectCustomTestReport(input(raw, 1))?.text).toContain('    ✓ diagnostic evidence, not a status row')
  })
  it('supports split-count success/failure reports without changing the trailer', () => {
    for (const failed of [0, 1]) {
      const raw = '■ suite\n' + passing(20) + (failed ? '  ✗ failed test\n' : '')
        + `\n============ 结果 ============\n通过: 20\n失败: ${failed}\n`
        + (failed ? '\n失败详情:\n  expected 1\n  actual 2\n' : '')
      const out = projectCustomTestReport(input(raw, failed))!
      expect(out.text).toContain(`通过: 20\n失败: ${failed}`)
      if (failed) expect(out.text).toContain('  expected 1\n  actual 2')
    }
  })
  it('preserves CRLF byte ranges and Unicode diagnostics', () => {
    const raw = report().replaceAll('\n', '\r\n')
    const output = projectCustomTestReport(input(raw))!
    expect(output.text).toContain('测试完成：20 通过，0 失败\r\n')
    for (const span of output.sourceMap.spans) if (span.sourceStart !== undefined) {
      expect(output.text.slice(span.outputStart, span.outputEnd)).toBe(raw.slice(span.sourceStart, span.sourceEnd))
    }
  })
  it.each([
    report().replace('20 通过', '19 通过'),
    report().replace('0 失败', '1 失败'),
    report().replace('全部通过 ✓\n', ''),
    report() + 'unknown trailer\n', report() + report(),
    report().replace('■ suite', 'not a recognized header'),
    report().replace('✓ assertion 1 ', 'unrecognized assertion 1 '),
    '\u001b[0m' + report(), report() + '\0', report().replace('■ suite', '■ suite\rbroken'),
    report(1).replace('失败清单：', 'unknown failure trailer'),
    report().replace('20 通过', '9007199254740992 通过'),
  ])('keeps ambiguous, incomplete or inconsistent reports unchanged (%#)', raw => {
    expect(projectCustomTestReport(input(raw))).toBeUndefined()
  })
  it.each([1, 2, 137])('does not compress a success report with exit status %i', exitCode => {
    expect(projectCustomTestReport(input(report(), exitCode))).toBeUndefined()
  })
  it('does not accept a failing report hidden behind a successful process status', () => {
    expect(projectCustomTestReport(input(report(1), 0))).toBeUndefined()
  })
  it.each(['node app.js', 'node -e code', 'node -r preload.js test/run-tests.mjs',
    'node test/run-tests.mjs | tail -10', 'node test/run-tests.mjs; cat evidence',
    'node test/run-tests.mjs --unknown'])('does not claim arbitrary commands are supported: %s', command => {
    expect(projectStaticFilter({ ...input(report()), command })).toBeUndefined()
  })
})
