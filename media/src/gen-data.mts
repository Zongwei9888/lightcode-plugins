// Runs the generated pytest log through TokenWise's real filter, so every "after" shown is genuine output.
import { writeFileSync } from 'node:fs'
const repo = new URL('../../', import.meta.url).pathname
const { projectStaticFilter } = await import(repo + 'packages/core/src/filters/index.ts')
const { pytestRun } = await import(new URL('./shared.js', import.meta.url).href)
const raw = pytestRun().map((r: any) => r.t).join('\n') + '\n'
const r = projectStaticFilter({ command: 'python3 -m pytest -v', stdout: raw, exitCode: 1 })
if (!r) throw new Error('not projected')
const tok = (s: string) => Math.ceil(s.length / 4)
const data = { raw, projected: r.text, filter: r.filter, rawLines: raw.trimEnd().split('\n').length, projectedLines: r.text.trimEnd().split('\n').length,
  rawBytes: Buffer.byteLength(raw), projectedBytes: Buffer.byteLength(r.text), rawTokens: tok(raw), projectedTokens: tok(r.text) }
writeFileSync(new URL('./data.json', import.meta.url), JSON.stringify(data, null, 1))
console.log(data.filter, data.rawLines, '->', data.projectedLines, 'lines;', data.rawBytes, '->', data.projectedBytes, 'bytes;', data.rawTokens, '->', data.projectedTokens, 'tokens')
console.log(r.text)
