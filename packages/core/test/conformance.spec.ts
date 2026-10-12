import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { projectStaticFilter } from '../src/filters/index.ts'
import { ECONOMY_RUNTIME_VERSION } from '../src/version.ts'

const root = new URL('../../../conformance/economy/', import.meta.url)
const corpus = JSON.parse(readFileSync(new URL('corpus.json', root), 'utf8')) as {
  cases: { id: string; command: string; stdout: string; exitCode: number; options?: unknown }[]
}
const golden = JSON.parse(readFileSync(new URL(`expected.${ECONOMY_RUNTIME_VERSION}.json`, root), 'utf8')) as {
  runtimeVersion: string; expected: { id: string; result: unknown }[]
}
const expected = new Map(golden.expected.map(item => [item.id, item.result]))

describe(`Economy conformance corpus (${ECONOMY_RUNTIME_VERSION})`, () => {
  it('covers every case exactly once', () => {
    expect(golden.runtimeVersion).toBe(ECONOMY_RUNTIME_VERSION)
    expect(corpus.cases.map(item => item.id).sort()).toEqual([...expected.keys()].sort())
  })
  it.each(corpus.cases.map(item => [item.id, item] as const))('%s', (_id, item) => {
    const result = projectStaticFilter({ command: item.command, stdout: item.stdout, exitCode: item.exitCode,
      ...item.options === undefined ? {} : { options: item.options as never } })
    expect(result === undefined ? null : { filter: result.filter, transformation: result.transformation,
      text: result.text, sourceMap: result.sourceMap }).toEqual(expected.get(item.id))
  })
})
