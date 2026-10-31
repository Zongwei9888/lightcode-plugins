import { describe, expect, it } from 'vitest'
import { DEFAULT_FILTER_OPTIONS, resolveFilterOptions } from '../src/filter-options.ts'
import { projectStaticFilter } from '../src/filters/index.ts'
import { STATIC_FILTERS } from '../src/filters/index.ts'
import { economyCoverage } from '../src/coverage.ts'
import { ECONOMY_FILTER_NAMES } from '../src/filter-names.ts'

describe('data-only filter options', () => {
  it('inventories every registered filter, each with its contract', () => {
    const coverage = economyCoverage()
    expect(coverage.filters.map(filter => filter.name)).toEqual(ECONOMY_FILTER_NAMES.filter(name => name !== 'learned-rule'))
    expect(coverage.filters.filter(filter => filter.entry === 'recognized-shell-output').map(filter => filter.name).sort())
      .toEqual(STATIC_FILTERS.map(filter => filter.name).sort())
    for (const filter of coverage.filters) expect(filter.preserves, filter.name).toMatch(/\w/u)
  })
  it('keeps default output identical and snapshots mutable input', () => {
    const input = { command: 'rg -n x src', stdout: Array.from({ length: 60 }, (_, i) => `a.ts:${i + 1}: x`).join('\n'), exitCode: 0 }
    expect(projectStaticFilter(input)).toEqual(projectStaticFilter({ ...input, options: DEFAULT_FILTER_OPTIONS }))
    const mutable = { grep: { maxPerFile: 40 } }
    const options = resolveFilterOptions(mutable)!
    mutable.grep.maxPerFile = 1
    expect(options.grep.maxPerFile).toBe(40)
    const result = projectStaticFilter({ ...input, options })!
    expect(result.text).toContain('a.ts:40: x')
    expect(result.text).not.toContain('a.ts:41: x')
    expect(result.text).toContain('20 more matches')
    expect(Object.isFrozen(options.grep)).toBe(true)
  })

  it.each([null, [], true, { grep: null }, { grep: { maxPerFile: '40' } }, { grep: { maxPerFile: 0 } },
    { grep: { maxPerFile: 201 } }, { grep: { maxPerFile: NaN } }, { grep: { maxPerFile: 2.5 } },
    { grep: { maxPerFile: undefined } }, { grep: { drop: 'error' } }, { execute: 'anything' },
    { 'git-diff': { maxHunkLines: 1 } }, { 'git-diff': { maxHunkLines: Infinity } },
  ])('rejects malformed options without coercion: %j', input => {
    expect(resolveFilterOptions(input)).toBeUndefined()
  })

  it('handles odd hunk budgets without off-by-one truncation', () => {
    const raw = 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -0,0 +1,8 @@\n' + Array.from({ length: 8 }, (_, i) => `+line-${i}\n`).join('')
    const projection = projectStaticFilter({ command: 'git diff', stdout: raw, exitCode: 0,
      options: resolveFilterOptions({ 'git-diff': { maxHunkLines: 5 } })!,
    })!
    expect(projection.text.match(/^\+line-/gm)).toHaveLength(5)
    expect(projection.text).toContain('3 lines truncated')
    for (const span of projection.sourceMap.spans) if (span.sourceStart !== undefined) {
      expect(projection.text.slice(span.outputStart, span.outputEnd)).toBe(raw.slice(span.sourceStart, span.sourceEnd))
    }
  })
})
