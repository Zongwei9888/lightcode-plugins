import { ProjectionBuilder, sourceLines } from '../projection-map.ts'
import type { FilterInput } from '../types.ts'
import { previewPositiveRows } from './test-preview.ts'

/** Routing hint only, never sufficient authorization to discard output. */
export function resemblesCustomTestReport(stdout: string): boolean {
  return /^(?:■ |测试完成：|通过: |失败: |失败清单：|失败详情:)/m.test(stdout)
}

const passRow = (text: string) => /^  ✓ \S/.test(text)
const failRow = (text: string) => /^  ✗ \S/.test(text)

/** Closed, counted assertion reports. Unfamiliar or incomplete output stays verbatim. */
export function projectCustomTestReport(input: FilterInput) {
  if (![0, 1].includes(input.exitCode) || /[\u001b\0]|\r(?!\n)/.test(input.stdout)) return undefined
  const lines = sourceLines(input.stdout)
  const summaries: { index: number; passed: number; failed: number; end: number; kind: 'inline' | 'split' }[] = []
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.text
    const inline = /^测试完成：(\d+) 通过，(\d+) 失败$/.exec(line)
    if (inline) summaries.push({ index, passed: Number(inline[1]), failed: Number(inline[2]), end: index, kind: 'inline' })
    const split = /^通过: (\d+)$/.exec(line)
    const failed = /^失败: (\d+)$/.exec(lines[index + 1]?.text ?? '')
    if (split && failed && /^=+ 结果 =+$/.test(lines[index - 1]?.text ?? '')) {
      summaries.push({ index, passed: Number(split[1]), failed: Number(failed[1]), end: index + 1, kind: 'split' })
    }
  }
  if (summaries.length === 0) {
    // A summary-only reporter has no detail rows to remove. Return an identity
    // candidate so the common profitability gate can report no gain accurately.
    const text = input.stdout.trim()
    const summary = /^[^\r\n:]{1,120}测试: (\d+) passed, (\d+) failed$/.exec(text)
    if (!summary || !consistent(Number(summary[1]), Number(summary[2]), input.exitCode)) return undefined
    const builder = new ProjectionBuilder(input.stdout)
    builder.keep(0, input.stdout.length)
    return builder.finish()
  }
  if (summaries.length !== 1) return undefined
  const summary = summaries[0]!
  if (!consistent(summary.passed, summary.failed, input.exitCode)) return undefined
  const body = lines.slice(0, summary.index)
  if (!body.some(line => /^■ \S/.test(line.text))
    || body.filter(line => passRow(line.text)).length !== summary.passed
    || body.filter(line => failRow(line.text)).length !== summary.failed) return undefined
  const tail = lines.slice(summary.end + 1).filter(line => line.text.trim() !== '')
  if (summary.failed === 0) {
    if (summary.kind === 'inline' ? tail.length !== 1 || tail[0]!.text !== '全部通过 ✓' : tail.length !== 0) return undefined
  } else {
    const marker = summary.kind === 'inline' ? '失败清单：' : '失败详情:'
    if (tail[0]?.text !== marker) return undefined
    // Failure detail is opaque and retained; reject a second report or status
    // rows appended after settlement, which could belong to another invocation.
    if (tail.slice(1).some(line => passRow(line.text) || /^■ |^测试完成：|^通过: |^失败: /.test(line.text))) return undefined
  }
  // Limit removal to the validated pre-summary region. Failure details that
  // happen to contain checkmarks must not be treated as passing assertions.
  const end = lines[summary.index]!.start
  const projected = previewPositiveRows(input.stdout.slice(0, end), passRow)
  if (projected === undefined) {
    const builder = new ProjectionBuilder(input.stdout)
    builder.keep(0, input.stdout.length)
    return builder.finish()
  }
  const builder = new ProjectionBuilder(input.stdout)
  builder.append(projected)
  builder.keep(end, input.stdout.length)
  return builder.finish()
}

function consistent(passed: number, failed: number, exitCode: number): boolean {
  return Number.isSafeInteger(passed) && Number.isSafeInteger(failed)
    && Number.isSafeInteger(passed + failed) && passed >= 0 && failed >= 0
    && (failed === 0 ? exitCode === 0 : exitCode === 1)
}
