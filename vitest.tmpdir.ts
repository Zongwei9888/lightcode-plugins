import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Give every test run its own TMPDIR. TokenWise falls back to a per-user data
 * directory there (`$TMPDIR/tokenwise-<uid>`), which real sandboxed runs fill;
 * tests that read their data directories must not see those records.
 */
export default function setup(): () => void {
  const dir = mkdtempSync(join(tmpdir(), 'tokenwise-test-'))
  process.env.TMPDIR = dir
  return () => rmSync(dir, { recursive: true, force: true })
}
