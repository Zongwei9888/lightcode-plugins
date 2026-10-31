import { STATIC_FILTERS } from './filters/index.ts'
import { ECONOMY_FILTER_NAMES, economyRuleDisplayName } from './filter-names.ts'
import type { EconomyFilterName } from './filter-names.ts'
import { DEFAULT_FILTER_OPTIONS } from './filter-options.ts'
import { ECONOMY_RUNTIME_VERSION } from './version.ts'

/** Executable inventory, not a claim of semantic correctness or measured API savings. */
const CONTRACTS = {
  'test-report': { format: 'complete recognized Cargo/Go/TAP reports and counted custom Node assertion reports', action: 'preview passing-status rows with explicit omission counts; custom reports require matching totals and exit status', preserves: 'failure bodies, unknown lines, section headers, totals, timing and stderr' },
  'cargo-build': { format: 'completed Cargo build/check/clippy/install text', action: 'remove recognized dependency progress rows', preserves: 'diagnostics, unknown build-script output and final status' },
  'ls-listing': { format: 'POSIX/BSD/GNU long ls rows in inspected output', action: 'preview type, size and exact filename tail', preserves: 'all names, symlink targets and unknown rows; omitted metadata is explicitly labelled' },
  'path-list': { format: 'consecutive path rows in inspected find output', action: 'group consecutive common directories', preserves: 'all paths in original order and surrounding non-path text' },
  'test-progress': { format: 'positive-status runs in successful test-command output', action: 'preview first/last row and count omitted rows', preserves: 'all non-positive rows, summaries and explicit omission counts' },
  'search-layout': { format: 'consecutive search records within inspected shell output', action: 'group repeated paths without removing matches', preserves: 'all matches, line numbers, order and surrounding non-record output' },
  pytest: { format: 'complete recognized pytest text', action: 'remove known progress before diagnostic sections', preserves: 'diagnostic bodies, collected counts, final summary and timing' },
  grep: { format: 'literal grep/rg filename:line:text records', action: 'preview first N matches per file', preserves: 'retained match order, omission count and incomplete-sample label' },
  'git-diff': { format: 'validated unified git patch hunks', action: 'preview head/tail of oversized hunks', preserves: 'file identities, hunk headers, change counts and patch-use warning' },
  tsc: { format: 'plain non-watch TypeScript diagnostics', action: 'fold adjacent byte-identical complete blocks', preserves: 'all distinct blocks, locations, diagnostic chains and duplicate counts' },
  'eslint-json': { format: 'explicit ESLint JSON report', action: 'remove layout whitespace outside strings', preserves: 'all fields, values, escapes, key order and numeric spelling' },
  'vite-build': { format: 'complete successful Vite build text', action: 'remove fixed phase lines and asset column padding', preserves: 'all assets, sizes, warnings and timing' },
  'pnpm-install': { format: 'complete successful pnpm dependency-operation text', action: 'keep last snapshot of each contiguous monotone progress run', preserves: 'warnings, scripts, dependency changes and final counts' },
  'native-grep': { format: "a host grep tool's own result: complete grouped `Line N:` rows (DeepSeek Harness) or `path:line:` rows (pi)", action: 'shorten Line N prefixes; group a file\'s consecutive rows under its path', preserves: 'every match, path, line number and order' },
  'native-glob': { format: "a host glob/find tool's own path list (DeepSeek Harness glob, pi find)", action: 'group consecutive paths by directory', preserves: 'every path, notice and order' },
  'ruff-json': { format: 'explicit Ruff check JSON report', action: 'remove layout whitespace outside strings', preserves: 'all findings, locations, fixes and extension fields' },
  'go-test-json': { format: 'explicit go test -json event stream', action: 'remove per-line JSON layout whitespace', preserves: 'all events in order and exact Output strings; compact input usually has no gain' },
  'git-show': { format: 'default-format `git show <commit>` and `git log -p` text: commit headers followed by validated unified patches', action: 'preview head/tail of oversized hunks, as git-diff', preserves: 'every commit header and message verbatim, file identities, hunk headers, change counts and patch-use warning; merge (--cc) diffs pass through' },
  'git-status': { format: 'English long git status text', action: 'remove four exact usage hints', preserves: 'all paths, statuses, branch information, conflicts and other text' },
} as const satisfies Partial<Record<EconomyFilterName, { format: string; action: string; preserves: string }>>

export function economyCoverage() {
  return {
    version: ECONOMY_RUNTIME_VERSION, defaultOptions: DEFAULT_FILTER_OPTIONS,
    // `learned-rule` is a reserved identifier: rule packs are not part of this release.
    filters: ECONOMY_FILTER_NAMES.filter(name => name !== 'learned-rule').map(name => ({ name, displayName: economyRuleDisplayName(name), ...CONTRACTS[name as keyof typeof CONTRACTS],
      transformation: STATIC_FILTERS.find(filter => filter.name === name)?.transformation ?? 'lossless-formatting',
      entry: name.startsWith('native-') ? 'native' : 'recognized-shell-output',
    })),
    boundaries: {
      command: 'command-specific parsers require literal commands; compound search records support lossless grouping only',
      passthrough: ['source reads', 'edit receipts', 'unknown MCP/multimodal output', 'background jobs', 'unknown/truncated/interrupted formats'],
      apply: 'requires a strictly smaller result in UTF-8 bytes and tokens, a saved private original and a journal record; the result names the original it can be read back from',
      rawAccess: 'local audit only; not advertised to the agent; local storage is not isolation from unrestricted same-user shell access',
    },
  }
}
