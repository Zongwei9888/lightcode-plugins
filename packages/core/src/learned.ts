import { createContext, Script } from 'node:vm'
import type { Context } from 'node:vm'
import { literalCommand } from './command.ts'
import { sha256 } from './hash.ts'
import { sourceLines } from './projection-map.ts'
import type { MappedProjection, SourceMap } from './projection-map.ts'
import type { EconomyTransformation, FilterCandidate, FilterInput } from './types.ts'

/**
 * Learned rules: filters `lc evolve` adopted after verification, kept as a
 * content-hashed directory and run before the built-in filters.
 *
 *   index.json        {"schemaVersion": 1, "rules": [{"id", "file", "transformation"}]}
 *   rules/<id>.js     a script that calls defineRule({ project(input, lc) { ... } }) once
 *
 * A rule's `project` returns null (not recognized) or `{ text, sourceMap }`,
 * built with the `lc` helpers so every copied span is exact. Each rule set
 * runs in its own V8 context that holds nothing of the host: no `require`,
 * `process`, file system, network, timers or string evaluation, and only
 * strings cross the boundary. Every call has a time limit. A result must
 * carry a valid source map, keep every diagnostic line (error, warning,
 * failure, traceback) and be smaller; otherwise the rule abstains. Any failure
 * means the built-in filters decide, as if no rule were learned.
 */

export const LEARNED_SCHEMA_VERSION = 1
export const MAX_LEARNED_RULES = 256
const MAX_INPUT_CHARS = 1_048_576
const RULE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u
const RULE_FILE = /^rules\/[a-z0-9][a-z0-9._-]{0,63}\.js$/u
const TRANSFORMATIONS: ReadonlySet<EconomyTransformation> = new Set(['noise-removal', 'preview', 'lossless-formatting'])
const DIAGNOSTIC = /\b(?:error|errors|warning|warnings|failed|failure|fatal|panic|traceback|exception)\b/iu
const ANSI = /\x1b\[[0-9;]*[a-zA-Z]/gu

/** One file of a rule directory: its path relative to the directory, with `/` separators. */
export interface RuleFile {
  readonly path: string
  readonly text: string
}

export interface LearnedRuleEntry {
  readonly id: string
  readonly file: string
  readonly transformation: EconomyTransformation
}

/** What a learned rule receives. Only stdout of shell commands reaches learned rules. */
export interface LearnedRuleInput {
  readonly kind: 'shell'
  readonly command: string
  /** The command as words, when it is a plain command without shell syntax; otherwise null. */
  readonly argv: readonly string[] | null
  readonly raw: string
  readonly exitCode: number
  readonly stream: 'stdout'
}

export interface LearnedCandidate extends FilterCandidate {
  readonly rule: string
}

export interface LearnedRuleSet {
  /** Content hash of the directory (see {@link ruleDirectoryHash}). */
  readonly hash: string
  readonly rules: readonly LearnedRuleEntry[]
  /** The first rule's admissible projection, or undefined. Never throws. */
  project(input: FilterInput): LearnedCandidate | undefined
  /** Per rule: calls that failed (threw, timed out or returned an invalid result). */
  readonly failures: ReadonlyMap<string, number>
}

export class RuleDirectoryError extends Error {
  override readonly name = 'RuleDirectoryError'
}

/** sha256 over the sorted files: JSON [path, UTF-8 length], a NUL, then the content, for each file. */
export function ruleDirectoryHash(files: readonly RuleFile[]): string {
  const sorted = [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  return sha256(sorted.map(file => `${JSON.stringify([file.path, Buffer.byteLength(file.text, 'utf8')])}\0${file.text}`).join(''))
}

/** Read and check `index.json`. */
export function parseRuleIndex(files: readonly RuleFile[]): LearnedRuleEntry[] {
  const index = files.find(file => file.path === 'index.json')
  if (!index) throw new RuleDirectoryError('index.json is missing')
  let value: unknown
  try { value = JSON.parse(index.text) } catch (error) { throw new RuleDirectoryError(`index.json: ${(error as Error).message}`) }
  const body = value as { schemaVersion?: unknown; rules?: unknown }
  if (body?.schemaVersion !== LEARNED_SCHEMA_VERSION || !Array.isArray(body.rules)) {
    throw new RuleDirectoryError(`index.json must be {"schemaVersion": ${LEARNED_SCHEMA_VERSION}, "rules": [...]}`)
  }
  if (body.rules.length > MAX_LEARNED_RULES) throw new RuleDirectoryError(`at most ${MAX_LEARNED_RULES} rules`)
  const seen = new Set<string>()
  return body.rules.map((item: unknown, i: number): LearnedRuleEntry => {
    const rule = item as { id?: unknown; file?: unknown; transformation?: unknown }
    const where = `index.json rules[${i}]`
    if (typeof rule.id !== 'string' || !RULE_ID.test(rule.id)) throw new RuleDirectoryError(`${where}: id must match ${RULE_ID}`)
    if (seen.has(rule.id)) throw new RuleDirectoryError(`${where}: duplicate id ${rule.id}`)
    seen.add(rule.id)
    if (typeof rule.file !== 'string' || !RULE_FILE.test(rule.file)) throw new RuleDirectoryError(`${where}: file must be rules/<name>.js`)
    if (!files.some(file => file.path === rule.file)) throw new RuleDirectoryError(`${where}: ${rule.file} is missing`)
    const transformation = rule.transformation ?? 'preview'
    if (typeof transformation !== 'string' || !TRANSFORMATIONS.has(transformation as EconomyTransformation)) {
      throw new RuleDirectoryError(`${where}: transformation must be noise-removal, preview or lossless-formatting`)
    }
    return { id: rule.id, file: rule.file, transformation: transformation as EconomyTransformation }
  })
}

/**
 * The helpers and the dispatcher, evaluated inside the rule context. Only
 * strings enter (`__input`) and leave (the JSON `__call` returns).
 */
const PRELUDE = String.raw`
'use strict';
const __rules = Object.create(null);
let __current = null;
const __lines = raw => {
  const out = [];
  let start = 0;
  while (start < raw.length) {
    const nl = raw.indexOf('\n', start);
    const end = nl < 0 ? raw.length : nl + 1;
    out.push(Object.freeze({ text: raw.slice(start, end).replace(/\r?\n$/, ''), start, end }));
    start = end;
  }
  return out;
};
const __builder = raw => {
  let text = '';
  const spans = [];
  return Object.freeze({
    keep(start, end) {
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > raw.length) throw new RangeError('keep: invalid source range');
      if (end === start) return;
      const outputStart = text.length;
      text += raw.slice(start, end);
      spans.push({ outputStart, outputEnd: text.length, sourceStart: start, sourceEnd: end });
    },
    keepLine(line) { this.keep(line.start, line.end); },
    generate(value, reason) {
      value = String(value);
      if (value === '') return;
      const outputStart = text.length;
      text += value;
      spans.push({ outputStart, outputEnd: text.length, generated: String(reason || 'learned') });
    },
    newline() { if (text !== '' && !text.endsWith('\n')) this.generate('\n', 'separator'); },
    finish() { return { text, sourceMap: { version: 1, unit: 'utf16', sourceLength: raw.length, outputLength: text.length, spans: spans.slice() } }; },
  });
};
const lc = Object.freeze({
  lines: __lines,
  builder: __builder,
  stripAnsi: value => String(value).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, ''),
  keepLines(raw, keep, note) {
    const b = __builder(raw);
    let omitted = 0;
    const lines = __lines(raw);
    lines.forEach((line, i) => { if (keep(line, i, lines)) b.keepLine(line); else omitted++; });
    if (omitted === 0) return null;
    b.newline();
    b.generate(typeof note === 'function' ? note(omitted) : '[' + omitted + ' line' + (omitted === 1 ? '' : 's') + ' omitted]\n', 'omission-note');
    return b.finish();
  },
});
const defineRule = definition => {
  if (__current === null) throw new Error('defineRule may only run while the rule file loads');
  if (__rules[__current] !== undefined) throw new Error('defineRule called twice');
  if (!definition || typeof definition.project !== 'function') throw new Error('defineRule needs { project(input, lc) }');
  __rules[__current] = definition.project;
};
var __load = id => { __current = id; };
var __loaded = id => { __current = null; if (__rules[id] === undefined) throw new Error('the rule file did not call defineRule'); };
var __input = '';
var __call = id => {
  try {
    const input = Object.freeze(JSON.parse(__input));
    const result = __rules[id](input, lc);
    if (result === null || result === undefined) return 'null';
    return JSON.stringify({ text: result.text, sourceMap: result.sourceMap });
  } catch (error) {
    let message = 'error';
    try { message = String(error && error.message !== undefined ? error.message : error).slice(0, 500); } catch {}
    return JSON.stringify({ error: message });
  }
};
`

interface RuleContext extends Context { __input: string }

/** Check a rule's result against the input: a contiguous source map whose copied spans are exact. */
export function validMappedProjection(raw: string, value: unknown): value is MappedProjection {
  const candidate = value as { text?: unknown; sourceMap?: SourceMap }
  if (typeof candidate?.text !== 'string') return false
  const map = candidate.sourceMap
  if (!map || map.version !== 1 || map.unit !== 'utf16' || map.sourceLength !== raw.length || map.outputLength !== candidate.text.length
    || !Array.isArray(map.spans)) return false
  let at = 0
  for (const span of map.spans) {
    if (!Number.isSafeInteger(span?.outputStart) || span.outputStart !== at || !Number.isSafeInteger(span.outputEnd) || span.outputEnd <= at) return false
    const piece = candidate.text.slice(span.outputStart, span.outputEnd)
    if (span.sourceStart !== undefined || span.sourceEnd !== undefined) {
      if (!Number.isSafeInteger(span.sourceStart) || !Number.isSafeInteger(span.sourceEnd) || span.sourceStart! < 0
        || span.sourceEnd! > raw.length || span.sourceEnd! - span.sourceStart! !== piece.length
        || raw.slice(span.sourceStart, span.sourceEnd) !== piece || span.generated !== undefined) return false
    } else if (typeof span.generated !== 'string') return false
    at = span.outputEnd
  }
  return at === candidate.text.length
}

/** Every diagnostic line of the input is still a line of the output. */
export function keepsDiagnostics(raw: string, text: string): boolean {
  const kept = new Set(sourceLines(text).map(line => line.text.replace(ANSI, '').trim()))
  for (const line of sourceLines(raw)) {
    if (DIAGNOSTIC.test(line.text) && !kept.has(line.text.replace(ANSI, '').trim())) return false
  }
  return true
}

/**
 * Compile a rule directory. Throws {@link RuleDirectoryError} when the
 * directory is malformed or a rule file fails to load; a loaded set never
 * throws while projecting.
 */
export function compileLearnedRules(files: readonly RuleFile[], options: { timeoutMs?: number } = {}): LearnedRuleSet {
  const timeout = options.timeoutMs ?? 100
  const rules = parseRuleIndex(files)
  const hash = ruleDirectoryHash(files)
  // A null-prototype global: nothing inside the context leads back to the host's objects.
  const context = createContext(Object.create(null) as object, {
    name: `lightcode-rules-${hash.slice(0, 12)}`,
    codeGeneration: { strings: false, wasm: false },
    microtaskMode: 'afterEvaluate',
  }) as RuleContext
  try {
    new Script(PRELUDE, { filename: 'lightcode-prelude.js' }).runInContext(context, { timeout })
    for (const rule of rules) {
      const source = files.find(file => file.path === rule.file)!.text
      new Script(`__load(${JSON.stringify(rule.id)})`).runInContext(context, { timeout })
      new Script(source, { filename: rule.file }).runInContext(context, { timeout })
      new Script(`__loaded(${JSON.stringify(rule.id)})`).runInContext(context, { timeout })
    }
  } catch (error) {
    throw new RuleDirectoryError(`loading rules failed: ${messageOf(error)}`)
  }
  const calls = new Map(rules.map(rule => [rule.id, new Script(`__call(${JSON.stringify(rule.id)})`)]))
  const failures = new Map<string, number>()
  const fail = (id: string) => { failures.set(id, (failures.get(id) ?? 0) + 1) }

  const project = (input: FilterInput): LearnedCandidate | undefined => {
    const raw = input.stdout
    if (raw.length === 0 || raw.length > MAX_INPUT_CHARS || /\0/u.test(raw)) return undefined
    const payload: LearnedRuleInput = { kind: 'shell', command: input.command, argv: literalCommand(input.command) ?? null, raw, exitCode: input.exitCode, stream: 'stdout' }
    let json: string
    try { json = JSON.stringify(payload) } catch { return undefined }
    for (const rule of rules) {
      let output: unknown
      try {
        context.__input = json
        output = calls.get(rule.id)!.runInContext(context, { timeout })
      } catch {
        fail(rule.id)
        continue
      } finally {
        context.__input = ''
      }
      if (typeof output !== 'string' || output === 'null') {
        if (typeof output !== 'string') fail(rule.id)
        continue
      }
      let result: unknown
      try { result = JSON.parse(output) } catch { fail(rule.id); continue }
      if ((result as { error?: unknown }).error !== undefined || !validMappedProjection(raw, result)) { fail(rule.id); continue }
      const mapped = result as MappedProjection
      // A rule that drops a diagnostic, or changes nothing, abstains.
      if (mapped.text === raw || mapped.text.trim() === '' || !keepsDiagnostics(raw, mapped.text)) continue
      return { filter: 'learned-rule', transformation: rule.transformation, rule: rule.id, text: mapped.text, sourceMap: mapped.sourceMap }
    }
    return undefined
  }
  return { hash, rules, project, failures }
}

function messageOf(error: unknown): string {
  try { return String((error as { message?: unknown })?.message ?? error).slice(0, 500) } catch { return 'unknown error' }
}
