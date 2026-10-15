import { FileArtifactStore, FileJournal, dataDirs, loadConfig, readJournals, resolveDataDir, writableDataDir } from '@lightcode-ai/store'
import type { LoadedConfig } from '@lightcode-ai/store'
import type { JournalRecord } from '@lightcode-ai/protocol'

export interface CliContext {
  /** Where configuration lives (`$LIGHTCODE_HOME` or `~/.lightcode`). */
  readonly dataDir: string
  /** Every location records may be in, primary first. */
  readonly dataDirs: readonly string[]
  readonly loaded: LoadedConfig
  readJournal(filter?: { host?: string; sessionId?: string | null }): JournalRecord[]
  readArtifact(sha256: string): string | undefined
  /** Journal and store in the first writable location; undefined when none is writable. */
  writable(): { dataDir: string; journal: FileJournal; artifacts: FileArtifactStore } | undefined
}

export function cliContext(options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): CliContext {
  const env = options.env ?? process.env
  const dataDir = resolveDataDir(env)
  const dirs = dataDirs(env)
  let writable: ReturnType<CliContext['writable']> | null = null
  return {
    dataDir,
    dataDirs: dirs,
    loaded: loadConfig({ dataDir, cwd: options.cwd ?? process.cwd(), env }),
    readJournal: filter => readJournals(dirs, filter),
    readArtifact: hash => {
      for (const dir of dirs) {
        const text = new FileArtifactStore(dir).read(hash)
        if (text !== undefined) return text
      }
      return undefined
    },
    writable: () => {
      if (writable === null) {
        const dir = writableDataDir(env)
        writable = dir === undefined ? undefined : { dataDir: dir, journal: new FileJournal(dir), artifacts: new FileArtifactStore(dir) }
      }
      return writable
    },
  }
}

export { onPath, shellQuote } from '@lightcode-ai/mechanisms'
