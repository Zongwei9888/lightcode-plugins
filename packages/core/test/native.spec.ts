import { describe, expect, it } from 'vitest'
import { createPolicy, decideNativeProjection, nativeGrepRecords, nativeGrepSections, nativePathLines, nativePathList } from '../src/index.ts'
import type { FilterCandidate, NativeSearchMatch } from '../src/index.ts'

/** Every copied span is the source text it claims to be. */
function copiesExactly(projection: FilterCandidate, raw: string) {
  for (const span of projection.sourceMap.spans) {
    if (span.sourceStart !== undefined) expect(projection.text.slice(span.outputStart, span.outputEnd)).toBe(raw.slice(span.sourceStart!, span.sourceEnd))
  }
  expect(projection.sourceMap.sourceLength).toBe(raw.length)
}

/** DeepSeek Harness's own grep rendering. */
const dshGrep = (matches: NativeSearchMatch[]) => {
  const groups = new Map<string, NativeSearchMatch[]>()
  for (const match of matches) groups.set(match.path, [...groups.get(match.path) ?? [], match])
  return `Found ${matches.length} ${matches.length === 1 ? 'match' : 'matches'}\n\n`
    + [...groups].map(([path, group]) => `${path}\n${group.map(m => `Line ${m.lineNumber}: ${m.line}`).join('\n')}`).join('\n\n')
}
const matches: NativeSearchMatch[] = [
  ...Array.from({ length: 6 }, (_, i) => ({ path: 'packages/core/src/economy.ts', lineNumber: 10 + i * 7, line: `  const value${i} = compute(${i}) // Line 3: not a prefix` })),
  { path: 'README.md', lineNumber: 4, line: 'Line 9: literal text' },
  { path: 'packages/core/src/economy.ts', lineNumber: 200, line: '' },
]

describe('native grep, DeepSeek Harness rendering', () => {
  it('drops only the `Line ` of each row and keeps every match', () => {
    const raw = dshGrep(matches)
    const projection = nativeGrepSections(matches, raw)!
    expect(projection).toMatchObject({ filter: 'native-grep', transformation: 'lossless-formatting' })
    copiesExactly(projection, raw)
    expect(projection.text.startsWith('Found 8 matches\n\npackages/core/src/economy.ts\n10:   const value0')).toBe(true)
    expect(projection.text).toContain('\n\nREADME.md\n4: Line 9: literal text')
    // Putting the prefix back restores the host's text exactly.
    expect(projection.text.replace(/^(\d+): /gm, 'Line $1: ')).toBe(raw)
  })

  it('touches nothing but the complete rendering of the structured matches', () => {
    const raw = dshGrep(matches)
    expect(nativeGrepSections(matches.slice(1), raw)).toBeUndefined()
    expect(nativeGrepSections(matches, raw.replace('Found 8 matches', 'Found 8 of 12 matches'))).toBeUndefined()
    expect(nativeGrepSections(matches, `${raw}\n\n(Full grep result stored at: /tmp/x.txt.)`)).toBeUndefined()
    expect(nativeGrepSections([], 'No matches found')).toBeUndefined()
    const multiline = [{ path: 'a.ts', lineNumber: 1, line: 'x\ny' }]
    expect(nativeGrepSections(multiline, dshGrep(multiline))).toBeUndefined()
    expect(nativeGrepSections([{ path: 'a.ts', lineNumber: 0, line: 'x' }], 'Found 1 match\n\na.ts\nLine 0: x')).toBeUndefined()
  })
})

describe('native grep, pi rendering', () => {
  const rows = (file: string, from: number, count: number) => Array.from({ length: count }, (_, i) => `${file}:${from + i}: row ${i} with: colons`)

  it('groups each file\'s consecutive rows and keeps context rows and notices verbatim', () => {
    const raw = [...rows('compaction-basic/src/config.ts', 19, 5), 'compaction-basic/src/index.ts-41- context', ...rows('compaction-basic/src/index.ts', 42, 2),
      ...rows('compaction-basic/tests/compaction-basic.spec.ts', 300, 4)].join('\n') + '\n\n[80 matches limit reached. Use limit=160 for more, or refine pattern]'
    const projection = nativeGrepRecords(raw)!
    expect(projection.filter).toBe('native-grep')
    copiesExactly(projection, raw)
    expect(projection.text).toContain('[matches in compaction-basic/src/config.ts; every match retained]\n  19: row 0 with: colons\n')
    // A context row counts towards its file's run and keeps its `-` separator; the notice stays.
    expect(projection.text).toContain('[matches and context lines in compaction-basic/src/index.ts; every line retained]\n  41- context\n  42: row 0 with: colons\n')
    expect(projection.text.endsWith('\n\n[80 matches limit reached. Use limit=160 for more, or refine pattern]')).toBe(true)
    const restored = projection.text.replace(/\[matches(?: and context lines)? in (.+?); every (?:match|line) retained\]\n((?: {2}.*(?:\n|$))+)/g,
      (_, file: string, block: string) => block.replace(/^ {2}(\d+)([:-])/gm, (_m: string, n: string, sep: string) => `${file}${sep}${n}${sep}`))
    expect(restored).toBe(raw)
    // Two rows of one file alone stay as they are.
    expect(nativeGrepRecords('src/a.ts:1: x\nsrc/a.ts:2: y\nsrc/b.ts:3: z')).toBeUndefined()
  })

  it('groups context lines with their file\'s matches, keeping each row\'s separator', () => {
    const file = 'compaction-basic/tests/compaction-basic.spec.ts', other = 'compaction-basic/src/config.ts'
    const raw = [`${other}-18- `, `${other}-19- /** Default */`, `${other}:20: const DEFAULT_THRESHOLD_RATIO = 0.8`, `${other}-21- `,
      `${file}-2306-       auto: false,`, `${file}:2307:       thresholdRatio: 0.8,`, `${file}-2308-       retainTokens: 350,`, `${file}-2309-     }), session)`,
      'src/v-2-x.ts-5- not a context row of a matched file'].join('\n')
    const projection = nativeGrepRecords(raw)!
    copiesExactly(projection, raw)
    expect(projection.text).toContain(`[matches and context lines in ${other}; every line retained]\n  18- \n  19- /** Default */\n  20: const DEFAULT`)
    expect(projection.text).toContain(`[matches and context lines in ${file}; every line retained]\n  2306-       auto: false,\n  2307:       thresholdRatio`)
    expect(projection.text.endsWith('\nsrc/v-2-x.ts-5- not a context row of a matched file')).toBe(true)
    const restored = projection.text.replace(/\[matches(?: and context lines)? in (.+?); every (?:match|line) retained\]\n((?: {2}.*(?:\n|$))+)/g,
      (_, owner: string, block: string) => block.replace(/^ {2}(\d+)([:-])/gm, (_m: string, n: string, sep: string) => `${owner}${sep}${n}${sep}`))
    expect(restored).toBe(raw)
  })

  it('leaves output without a run of one file\'s rows alone', () => {
    expect(nativeGrepRecords('No matches found')).toBeUndefined()
    expect(nativeGrepRecords('a.ts:1: x\nb.ts:2: y\na.ts:3: z')).toBeUndefined()
    expect(nativeGrepRecords(`${rows('src/a.ts', 1, 4).join('\n')}\u001b[0m`)).toBeUndefined()
  })
})

describe('native path lists', () => {
  const paths = ['src/a/one.ts', 'src/a/two.ts', 'src/a/three.ts', 'README.md', 'src/b/four.ts', 'src/a/five.ts', 'src/a/six.ts', 'docs/']

  it('groups consecutive paths by directory in their original order', () => {
    const raw = paths.join('\n')
    const projection = nativePathList(paths, raw)!
    expect(projection).toMatchObject({ filter: 'native-glob', transformation: 'lossless-formatting' })
    copiesExactly(projection, raw)
    expect(projection.text).toBe('[paths grouped by directory; original order retained]\n'
      + 'src/a/\n  one.ts\n  two.ts\n  three.ts\nREADME.md\nsrc/b/four.ts\nsrc/a/\n  five.ts\n  six.ts\ndocs/')
  })

  it('keeps notices and only takes the complete path list', () => {
    const raw = `${paths.slice(0, 3).join('\n')}\n\n[1000 results limit reached. Use limit=2000 for more, or refine pattern]`
    const projection = nativePathLines(raw)!
    copiesExactly(projection, raw)
    expect(projection.text.endsWith('  three.ts\n\n[1000 results limit reached. Use limit=2000 for more, or refine pattern]')).toBe(true)
    expect(nativePathList(paths, `${paths.join('\n')}\n\n(Showing 8 of 20 paths.)`)).toBeUndefined()
    expect(nativePathList(['a/b', 'a/c\nd'], 'a/b\na/c\nd')).toBeUndefined()
    expect(nativePathLines('one.ts\ntwo.ts\nthree.ts')).toBeUndefined()
    expect(nativePathLines('No files found matching pattern')).toBeUndefined()
  })
})

describe('native admission', () => {
  const policy = createPolicy()
  it('admits only a strictly smaller projection that saves tokens', () => {
    const raw = dshGrep(matches)
    expect(decideNativeProjection({ rendered: raw, projection: nativeGrepSections(matches, raw) }, { policy }))
      .toMatchObject({ kind: 'project', filter: 'native-grep', stream: 'stdout' })
    expect(decideNativeProjection({ rendered: raw, projection: undefined }, { policy }))
      .toMatchObject({ kind: 'pass', reason: 'no-filter-match', matchDetail: 'output-format-unrecognized' })
    const one = [{ path: 'a/b.ts', lineNumber: 1, line: 'x' }]
    expect(decideNativeProjection({ rendered: dshGrep(one), projection: nativeGrepSections(one, dshGrep(one)) }, { policy, minimumSavedTokens: 5 }))
      .toMatchObject({ kind: 'pass', reason: 'non-growth-rejected' })
  })
})
