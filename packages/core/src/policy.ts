import { DEFAULT_FILTER_OPTIONS, resolveFilterOptions } from './filter-options.ts'
import type { FilterOptions } from './filter-options.ts'
import { digest } from './hash.ts'
import { ECONOMY_RUNTIME_VERSION } from './version.ts'

/**
 * Everything that decides a projection, captured once per task or session.
 * A result's projection is fixed when the model first sees it; later policy
 * changes never re-render it, which keeps the host's prompt cache stable.
 */
export interface EconomyPolicy {
  readonly schemaVersion: 1
  readonly kind: 'economy-filter-policy'
  readonly runtimeVersion: typeof ECONOMY_RUNTIME_VERSION
  readonly filterOptions: FilterOptions
  readonly policyHash: string
}

/** Undefined options mean defaults; malformed options throw instead of being partly applied. */
export function createPolicy(filterOptions: unknown = DEFAULT_FILTER_OPTIONS): EconomyPolicy {
  const options = resolveFilterOptions(filterOptions)
  if (!options) throw new Error('invalid Economy filter options')
  const body = { schemaVersion: 1 as const, kind: 'economy-filter-policy' as const, runtimeVersion: ECONOMY_RUNTIME_VERSION, filterOptions: options }
  return Object.freeze({ ...body, policyHash: digest(body) })
}
