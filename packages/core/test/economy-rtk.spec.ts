import { describe, expect, it } from 'vitest'
import { RTK_CASES } from './fixtures/rtk-cases.ts'
import { RTK_BUILTINS } from '../src/rtk/builtins.ts'
import { RTK_CATALOG, RTK_FILTER_IDS } from '../src/rtk/catalog.ts'
import { compileRtkRule } from '../src/rtk/engine.ts'
import { RTK_FILTERS, matchesRtkCommand } from '../src/rtk/filters.ts'
import { projectStaticFilter } from '../src/filters/index.ts'

describe('pinned RTK declarative rule parity (not native Rust command parity)', () => {
  const commands: Readonly<Record<string, string>> = {
    'brew-install': 'brew install fixture', 'bundle-install': 'bundle install', 'composer-install': 'composer install',
    'dotnet-build': 'dotnet build', 'gradle': 'gradle build', 'mise': 'mise run test',
    'mix-compile': 'mix compile', 'mix-format': 'mix format', 'ollama': 'ollama run fixture',
    'pio-run': 'pio run', 'poetry-install': 'poetry install', 'quarto-render': 'quarto render',
    'shopify-theme': 'shopify theme push', 'spring-boot': 'mvn spring-boot:run', 'swift-build': 'swift build',
    'systemctl-status': 'systemctl status fixture', 'terraform-plan': 'terraform plan',
    'tofu-fmt': 'tofu fmt', 'tofu-init': 'tofu init', 'tofu-plan': 'tofu plan', 'tofu-validate': 'tofu validate',
    'trunk-build': 'trunk build', 'uv-sync': 'uv sync', 'pulumi-destroy': 'pulumi destroy',
    'pulumi-preview': 'pulumi preview', 'pulumi-refresh': 'pulumi refresh', 'pulumi-stack': 'pulumi stack', 'pulumi-up': 'pulumi up',
  }
  const compiled = new Map(RTK_BUILTINS.map(rule => [rule.id, compileRtkRule(rule)]))
  // These upstream examples discard diagnostic or status rows. The interpreter
  // still reproduces them below; the Economy adapter must retain raw.
  const auditOnlyPreviews = new Set([
    'brew-install/already installed short-circuits',
    'dotnet-build/successful build short-circuits to ok',
    'gcc/strips include chain, keeps errors and warnings',
    'helm/strips glog W-prefix warnings',
    'oxlint/strips noise, keeps diagnostics',
    'ssh/strips connection banners, keeps command output',
  ])
  it('accounts for every imported rule and requires upstream fixtures', () => {
    expect(RTK_BUILTINS.map(rule => rule.id)).toEqual([...RTK_FILTER_IDS])
    expect(RTK_FILTERS.map(filter => filter.name)).toEqual([...RTK_FILTER_IDS])
    expect(RTK_CATALOG).toHaveLength(63)
    for (const id of RTK_FILTER_IDS) expect(RTK_CASES.some(test => `rtk/${test.filter}` === id)).toBe(true)
  })
  it.each(RTK_FILTER_IDS)('routes a real command head to %s, not just a direct fixture call', id => {
    const name = id.slice(4)
    const command = commands[name] ?? `${name} fixture`
    expect(matchesRtkCommand(command)).toBe(true)
    const adapter = RTK_FILTERS.find(filter => filter.name === id)!
    const cases = RTK_CASES.filter(test => `rtk/${test.filter}` === id)
    // Every non-identity upstream example reaches its adapter; safety refusal
    // is distinct from missing command coverage.
    const changed = cases.filter(test => compiled.get(id)!.project(test.input).text.trim() !== test.input.trim())
    for (const test of changed) {
      const result = adapter.projectMapped({ command, stdout: test.input, exitCode: 0 })
      if (auditOnlyPreviews.has(`${test.filter}/${test.name}`)) {
        expect(result).toBeUndefined()
        continue
      }
      // Empty input summaries are never presented as useful tool reductions.
      if (test.expected.trim() !== '') expect(result?.text).toContain(test.expected.trim())
    }
  })
  it.each(RTK_FILTER_IDS)('routes %s when the program is given by its path, with the same projection', id => {
    const name = id.slice(4)
    const command = commands[name] ?? `${name} fixture`
    const byPath = `/usr/local/bin/${command}`
    expect(matchesRtkCommand(byPath)).toBe(true)
    const adapter = RTK_FILTERS.find(filter => filter.name === id)!
    for (const test of RTK_CASES.filter(item => `rtk/${item.filter}` === id)) {
      expect(adapter.projectMapped({ command: byPath, stdout: test.input, exitCode: 0 })?.text)
        .toBe(adapter.projectMapped({ command, stdout: test.input, exitCode: 0 })?.text)
    }
  })
  it.each(RTK_CASES)('$filter / $name', test => {
    const projected = compiled.get(`rtk/${test.filter}`)!.project(test.input)
    // Upstream verification ignores surrounding whitespace in inline TOML fixtures.
    expect(projected.text.trim()).toBe(test.expected.trim())
    for (const span of projected.sourceMap.spans) if (span.sourceStart !== undefined) {
      expect(projected.text.slice(span.outputStart, span.outputEnd)).toBe(test.input.slice(span.sourceStart, span.sourceEnd))
    }
  })
  it('actually enters the shared registry and retains unknown diagnostic text', () => {
    const stdout = 'make[1]: Entering directory /repo\n'.repeat(100) + 'gcc -O2 main.c\nwarning: keep this\n'
    const projected = projectStaticFilter({ command: 'make build', stdout, exitCode: 0 })!
    expect(projected.filter).toBe('rtk/make')
    expect(projected.text).toContain('warning: keep this')
    expect(projected.text).not.toMatch(/recover|full original/i)
    expect(projected.text).toContain('[TokenWise make filtered output]')
    expect(projected.text).not.toContain('[RTK ')
    expect(projected.text.length).toBeLessThan(stdout.length)
  })
  it('does not reclassify a compound or replace failed command output with an ok shortcut', () => {
    const filter = RTK_FILTERS.find(item => item.name === 'rtk/brew-install')!
    for (const input of [
      { command: 'brew install x', stdout: 'already installed\nerror: failed postinstall', exitCode: 1 },
      { command: 'brew install x && cat secret', stdout: 'already installed\nimportant', exitCode: 0 },
    ]) expect(filter.projectMapped(input)).toBeUndefined()
  })
  it('keeps original output if a success shortcut or cap would hide diagnostics even at exit zero', () => {
    const brew = RTK_FILTERS.find(item => item.name === 'rtk/brew-install')!
    expect(brew.projectMapped({ command: 'brew install x', stdout: 'already installed\nwarning: incompatible ABI\n', exitCode: 0 })).toBeUndefined()
    const make = RTK_FILTERS.find(item => item.name === 'rtk/make')!
    expect(make.projectMapped({ command: 'make build', stdout: 'unclassified compiler output\n'.repeat(200) + 'error: final diagnostic\n', exitCode: 0 })).toBeUndefined()
  })
})
