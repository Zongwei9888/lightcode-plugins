import { closeSync, existsSync, fsyncSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { sha256 } from '@lightcode/core'
import type { ArtifactPort, ArtifactRef } from '@lightcode/protocol'
import { ensurePrivateDir } from './paths.ts'

const HASH = /^[a-f0-9]{64}$/

/** Content-addressed original outputs under `<data>/artifacts`, readable only by the user. */
export class FileArtifactStore implements ArtifactPort {
  readonly root: string
  constructor(dataDir: string) {
    this.root = join(dataDir, 'artifacts')
  }

  private pathOf(hash: string): string {
    return join(this.root, hash.slice(0, 2), `${hash}.txt`)
  }

  save(text: string): ArtifactRef {
    const hash = sha256(text)
    const path = this.pathOf(hash)
    const ref = { sha256: hash, bytes: Buffer.byteLength(text, 'utf8') }
    if (existsSync(path)) {
      // Same content: refresh its retention clock instead of writing it again.
      const now = new Date()
      utimesSync(path, now, now)
      return ref
    }
    ensurePrivateDir(join(this.root, hash.slice(0, 2)))
    const temp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    const fd = openSync(temp, 'wx', 0o600)
    try {
      writeSync(fd, text, null, 'utf8')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(temp, path)
    return ref
  }

  read(hash: string): string | undefined {
    if (!HASH.test(hash)) return undefined
    let text: string
    try { text = readFileSync(this.pathOf(hash), 'utf8') } catch { return undefined }
    return sha256(text) === hash ? text : undefined
  }

  /** Delete originals not saved or re-saved for `maxAgeDays`. Returns how many were removed. */
  prune(maxAgeDays: number, now = Date.now()): number {
    const cutoff = now - maxAgeDays * 86_400_000
    let removed = 0
    let shards: string[]
    try { shards = readdirSync(this.root) } catch { return 0 }
    for (const shard of shards) {
      if (!/^[a-f0-9]{2}$/.test(shard)) continue
      for (const name of readdirSync(join(this.root, shard))) {
        const path = join(this.root, shard, name)
        try {
          if (statSync(path).mtimeMs < cutoff) { rmSync(path, { force: true }); removed++ }
        } catch { /* Concurrently removed. */ }
      }
    }
    return removed
  }
}
