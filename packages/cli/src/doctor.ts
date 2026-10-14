import { economyCoverage, ECONOMY_RUNTIME_VERSION, RTK_REVISION } from '@lightcode/core'
import { HOST_PROFILES, V0_2_SPECS, negotiate } from '@lightcode/protocol'
import { cliContext, onPath } from './context.ts'

export const VERSION = '0.2.0'

export function doctor(options: { json?: boolean } = {}): number {
  const context = cliContext()
  const { config, sources, problems } = context.loaded
  const requested = { economy: config.economy.mode, 'command-normalization': config.economy.commandNormalization ? 'apply' as const : 'off' as const,
    lightshadow: config.lightshadow.mode }
  const hosts = Object.values(HOST_PROFILES).map(profile => ({
    host: profile.id, name: profile.name, integration: profile.integration,
    mechanisms: negotiate(V0_2_SPECS, profile.capabilities, requested), notes: profile.notes,
  }))
  const writable = context.writable()
  const result = {
    version: VERSION, runtimeVersion: ECONOMY_RUNTIME_VERSION, node: process.version, dataDir: context.dataDir,
    dataDirs: context.dataDirs, writableDataDir: writable?.dataDir ?? null, lcOnPath: onPath('lc') ?? null,
    config: { ...config, sources, problems }, filters: economyCoverage().filters.length, rtkRevision: RTK_REVISION, hosts,
  }
  if (options.json) { process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return problems.length ? 1 : 0 }
  const lines = [
    `LightCode ${VERSION} (Economy ${ECONOMY_RUNTIME_VERSION}, ${result.filters} filters, RTK ${RTK_REVISION.slice(0, 7)})`,
    `  node        ${process.version}`,
    `  data        ${context.dataDir}${writable?.dataDir === context.dataDir ? '' : writable ? ` (not writable here; using ${writable.dataDir})` : ' (not writable: nothing will be filtered)'}`,
    `  lc on PATH  ${result.lcOnPath ?? 'no — Codex hooks need `lc` on PATH'}`,
    `  config      ${sources.length ? sources.join(', ') : 'defaults'}`,
    `  economy     mode=${config.economy.mode} minimumSavedTokens=${config.economy.minimumSavedTokens} retention=${config.artifacts.retentionDays}d`,
    `  lightshadow mode=${config.lightshadow.mode}`,
    `  evolution   evidence=${config.economy.evidence ? 'kept (every complete shell output, except credential-looking ones)' : 'off'} learnedRules=${config.economy.learnedRules ? 'on' : 'off'}`,
  ]
  for (const problem of problems) lines.push(`  ! ${problem} (Economy and LightShadow are off until this is fixed)`)
  for (const host of hosts) {
    lines.push('', `${host.name} [${host.integration}]`)
    for (const item of host.mechanisms) lines.push(`  ${item.mechanism.padEnd(22)} ${item.mode.padEnd(8)} ${item.reason}`)
    for (const note of host.notes) lines.push(`  · ${note}`)
  }
  process.stdout.write(lines.join('\n') + '\n')
  return problems.length ? 1 : 0
}
