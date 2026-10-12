/** Bounded data-only options. No learned code, regexes, or silent coercion. */
export interface FilterOptions {
  readonly grep: { readonly maxPerFile: number }
  readonly 'git-diff': { readonly maxHunkLines: number }
}

export const DEFAULT_FILTER_OPTIONS: FilterOptions = Object.freeze({
  grep: Object.freeze({ maxPerFile: 25 }),
  'git-diff': Object.freeze({ maxHunkLines: 100 }),
})

export const FILTER_OPTION_LIMITS = Object.freeze({
  grep: Object.freeze({ min: 1, max: 200 }),
  'git-diff': Object.freeze({ min: 2, max: 1000 }),
})

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Undefined means defaults; malformed input is rejected rather than partly applied. */
export function resolveFilterOptions(input: unknown): FilterOptions | undefined {
  if (input === undefined) return DEFAULT_FILTER_OPTIONS
  if (!record(input) || Object.keys(input).some(key => !['grep', 'git-diff'].includes(key))) return undefined
  const read = (family: string, field: string, fallback: number, min: number, max: number): number | undefined => {
    if (!Object.hasOwn(input, family)) return fallback
    const value = input[family]
    if (!record(value) || Object.keys(value).some(key => key !== field)) return undefined
    if (!Object.hasOwn(value, field)) return fallback
    const number = value[field]
    return typeof number === 'number' && Number.isSafeInteger(number) && number >= min && number <= max ? number : undefined
  }
  const maxPerFile = read('grep', 'maxPerFile', DEFAULT_FILTER_OPTIONS.grep.maxPerFile, FILTER_OPTION_LIMITS.grep.min, FILTER_OPTION_LIMITS.grep.max)
  const maxHunkLines = read('git-diff', 'maxHunkLines', DEFAULT_FILTER_OPTIONS['git-diff'].maxHunkLines, FILTER_OPTION_LIMITS['git-diff'].min, FILTER_OPTION_LIMITS['git-diff'].max)
  if (maxPerFile === undefined || maxHunkLines === undefined) return undefined
  return Object.freeze({ grep: Object.freeze({ maxPerFile }), 'git-diff': Object.freeze({ maxHunkLines }) })
}
