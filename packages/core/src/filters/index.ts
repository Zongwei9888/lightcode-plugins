import { gitDiffFilter, gitShowFilter } from './git-diff.ts'
import { gitBlameFilter, gitLogFilter } from './git-log.ts'
import { grepFilter } from './grep.ts'
import { pytestFilter } from './pytest.ts'
import { tscFilter } from './tsc.ts'
import { eslintJsonFilter } from './eslint-json.ts'
import { viteBuildFilter } from './vite-build.ts'
import { pnpmInstallFilter } from './pnpm-install.ts'
import { ruffJsonFilter } from './ruff-json.ts'
import { goTestJsonFilter } from './go-test-json.ts'
import { gitStatusFilter } from './git-status.ts'
import { searchLayoutFilter } from './search-layout.ts'
import { pathListFilter } from './path-list.ts'
import { testProgressFilter } from './test-progress.ts'
import { lsListingFilter } from './ls-listing.ts'
import { testReportFilter } from './test-report.ts'
import { cargoBuildFilter } from './cargo-build.ts'
import type { EconomyFilter, FilterCandidate, FilterInput } from '../types.ts'

export const STATIC_FILTERS: readonly EconomyFilter[] = Object.freeze([
  pytestFilter, grepFilter, gitDiffFilter, tscFilter, eslintJsonFilter, viteBuildFilter, pnpmInstallFilter,
  ruffJsonFilter, goTestJsonFilter, gitStatusFilter, searchLayoutFilter, pathListFilter, testProgressFilter, lsListingFilter, testReportFilter, cargoBuildFilter, gitShowFilter,
  gitLogFilter, gitBlameFilter,
])

export function projectStaticFilter(input: FilterInput): FilterCandidate | undefined {
  for (const filter of STATIC_FILTERS) {
    const projection = filter.projectMapped(input)
    if (projection !== undefined) return { filter: filter.name, transformation: filter.transformation, ...projection }
  }
  return undefined
}

export { gitBlameFilter, gitDiffFilter, gitLogFilter, gitShowFilter, grepFilter, pytestFilter }
export { tscFilter, eslintJsonFilter, viteBuildFilter, pnpmInstallFilter }
