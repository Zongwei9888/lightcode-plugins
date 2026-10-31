/**
 * Write expected.<ECONOMY_RUNTIME_VERSION>.json from the current filters, and
 * list every case whose result differs from the previous version's file.
 * Review that list: only the changes a new runtime version intends may appear.
 *
 *   node --conditions=source conformance/economy/write-expected.mts [previous-version]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { projectStaticFilter } from '../../packages/core/src/filters/index.ts'
import { ECONOMY_RUNTIME_VERSION } from '../../packages/core/src/version.ts'

const dir = new URL('./', import.meta.url)
const corpus = JSON.parse(readFileSync(new URL('corpus.json', dir), 'utf8')) as {
  cases: { id: string; command: string; stdout: string; exitCode: number; options?: unknown }[]
}
const expected = corpus.cases.map(item => {
  const result = projectStaticFilter({ command: item.command, stdout: item.stdout, exitCode: item.exitCode,
    ...item.options === undefined ? {} : { options: item.options as never } })
  return { id: item.id, result: result === undefined ? null
    : { filter: result.filter, transformation: result.transformation, text: result.text, sourceMap: result.sourceMap } }
})
const previous = process.argv[2]
const before = previous && existsSync(new URL(`expected.${previous}.json`, dir))
  ? new Map((JSON.parse(readFileSync(new URL(`expected.${previous}.json`, dir), 'utf8')) as { expected: { id: string; result: unknown }[] })
    .expected.map(item => [item.id, JSON.stringify(item.result)]))
  : undefined
if (before) {
  for (const item of expected) {
    const was = before.get(item.id)
    if (was === undefined) console.log(`new      ${item.id}`)
    else if (was !== JSON.stringify(item.result)) console.log(`changed  ${item.id}`)
  }
}
writeFileSync(new URL(`expected.${ECONOMY_RUNTIME_VERSION}.json`, dir),
  `{"schemaVersion":1,"runtimeVersion":"${ECONOMY_RUNTIME_VERSION}","expected":[\n${expected.map(item => JSON.stringify(item)).join(',\n')}\n]}\n`)
console.log(`${expected.length} cases written to expected.${ECONOMY_RUNTIME_VERSION}.json`)
