/** Stable filter identifiers. They are recorded in journals and rule packs, so never rename one. */
import { RTK_FILTER_IDS } from './rtk/catalog.ts'

export const ECONOMY_FILTER_NAMES = ['pytest', 'grep', 'git-diff', 'tsc', 'eslint-json', 'vite-build', 'pnpm-install', 'native-grep', 'native-glob', 'ruff-json', 'go-test-json', 'git-status', 'search-layout', 'path-list', 'test-progress', 'ls-listing', 'test-report', 'cargo-build', 'learned-rule', ...RTK_FILTER_IDS] as const
export type EconomyFilterName = typeof ECONOMY_FILTER_NAMES[number]

/** Product-facing rule name. Durable IDs remain unchanged for historical evidence and policies. */
export function economyRuleDisplayName(name: EconomyFilterName): string {
  return name.startsWith('rtk/') ? name.slice(4) : name
}
