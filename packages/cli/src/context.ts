import { FileArtifactStore, FileJournal, loadConfig, resolveDataDir } from '@lightcode/store'
import type { LoadedConfig } from '@lightcode/store'

export interface CliContext {
  readonly dataDir: string
  readonly journal: FileJournal
  readonly artifacts: FileArtifactStore
  readonly loaded: LoadedConfig
}

export function cliContext(options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): CliContext {
  const env = options.env ?? process.env
  const dataDir = resolveDataDir(env)
  return {
    dataDir,
    journal: new FileJournal(dataDir),
    artifacts: new FileArtifactStore(dataDir),
    loaded: loadConfig({ dataDir, cwd: options.cwd ?? process.cwd(), env }),
  }
}

/** POSIX single-quoting: the result is one literal word in sh, bash and zsh. */
export function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:=@%+,-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}
