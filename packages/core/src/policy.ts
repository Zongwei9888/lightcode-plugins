import { DEFAULT_FILTER_OPTIONS, resolveFilterOptions } from './filter-options.ts'
import type { FilterOptions } from './filter-options.ts'
import { digest } from './hash.ts'
import type { LearnedRuleSet } from './learned.ts'
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
  /** Content hash of the learned rules tried before the built-in filters, or null. */
  readonly learnedRulesHash: string | null
  readonly policyHash: string
  /** The learned rules themselves (not part of the hash body: their content hash is). */
  readonly learned?: LearnedRuleSet
}

/** Undefined options mean defaults; malformed options throw instead of being partly applied. */
export function createPolicy(filterOptions: unknown = DEFAULT_FILTER_OPTIONS, learned?: LearnedRuleSet): EconomyPolicy {
  const options = resolveFilterOptions(filterOptions)
  if (!options) throw new Error('invalid filter options')
  const body = { schemaVersion: 1 as const, kind: 'economy-filter-policy' as const, runtimeVersion: ECONOMY_RUNTIME_VERSION, filterOptions: options,
    learnedRulesHash: learned?.hash ?? null }
  return Object.freeze({ ...body, policyHash: digest(body), ...learned ? { learned } : {} })
}
