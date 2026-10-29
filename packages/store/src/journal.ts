import { appendFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { JournalPort, JournalRecord } from '@tokenwise/protocol'
import { ensurePrivateDir, pathSegment } from './paths.ts'

const UNBOUND = '_unbound'

/**
 * One JSONL file per host session under `<data>/journal/<host>/`. Each record
 * is one `appendFile` call, so concurrent `tokenwise run` processes do not interleave
 * partial lines on local file systems.
 */
export class FileJournal implements JournalPort {
  readonly root: string
  constructor(dataDir: string) {
    this.root = join(dataDir, 'journal')
  }

  fileOf(host: string, sessionId: string | null): string {
    return join(this.root, pathSegment(host), `${sessionId === null ? UNBOUND : pathSegment(sessionId)}.jsonl`)
  }

  append(record: JournalRecord): void {
    const path = this.fileOf(record.host, record.sessionId)
    ensurePrivateDir(join(path, '..'))
    appendFileSync(path, JSON.stringify(record) + '\n', { mode: 0o600 })
  }

  /** Records in file order; malformed lines (for example from a crash mid-write) are skipped. */
  read(filter: { host?: string; sessionId?: string | null } = {}): JournalRecord[] {
    const files: string[] = []
    if (filter.host !== undefined && filter.sessionId !== undefined) files.push(this.fileOf(filter.host, filter.sessionId))
    else {
      let hosts: string[]
      try { hosts = filter.host === undefined ? readdirSync(this.root) : [pathSegment(filter.host)] } catch { return [] }
      for (const host of hosts) {
        try {
          for (const name of readdirSync(join(this.root, host)).sort()) if (name.endsWith('.jsonl')) files.push(join(this.root, host, name))
        } catch { /* Not a directory. */ }
      }
    }
    const records: JournalRecord[] = []
    const wanted = filter.sessionId
    for (const file of files) {
      let text: string
      try { text = readFileSync(file, 'utf8') } catch { continue }
      for (const line of text.split('\n')) {
        if (!line) continue
        try {
          const value = JSON.parse(line) as JournalRecord
          if (value?.schemaVersion === 1 && typeof value.type === 'string' && (wanted === undefined || value.sessionId === wanted)) records.push(value)
        } catch { /* Partial line. */ }
      }
    }
    return records
  }
}

/** Records from every data directory (see `dataDirs`). */
export function readJournals(dirs: readonly string[], filter: { host?: string; sessionId?: string | null } = {}): JournalRecord[] {
  return dirs.flatMap(dir => new FileJournal(dir).read(filter))
}
