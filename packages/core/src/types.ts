import type { MappedProjection } from './projection-map.ts'
import type { EconomyFilterName } from './filter-names.ts'
import type { FilterOptions } from './filter-options.ts'
export { ECONOMY_FILTER_NAMES } from './filter-names.ts'
export type { EconomyFilterName } from './filter-names.ts'

export type EconomyTransformation = 'noise-removal' | 'preview' | 'lossless-formatting' | 'diagnostic-deduplication'

export interface FilterInput {
  readonly command: string
  readonly stdout: string
  readonly exitCode: number
  readonly options?: FilterOptions
}

export interface FilterCandidate extends MappedProjection {
  readonly filter: EconomyFilterName
  readonly transformation: EconomyTransformation
  readonly text: string
}

export interface EconomyFilter {
  readonly name: EconomyFilterName
  readonly transformation: EconomyTransformation
  project(input: FilterInput): string | undefined
  projectMapped(input: FilterInput): MappedProjection | undefined
}
