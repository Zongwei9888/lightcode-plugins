/**
 * Adopt a learned rule directly in a LightCode home, the way `lc evolve`
 * leaves it: `<home>/rules/<hash>/` and `rules/active.json`. The hash is the
 * content hash LightCode verifies on load.
 */
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const BUILD_PROGRESS = Array.from({ length: 120 }, (_, i) => `[${String(i + 1).padStart(3)}/120] Compiling module_${i}`).join('\n')
export const BUILD_LEARNED = 'Finished in 3.1s\n[120 progress lines omitted]\n'

export function writeBuildScript(dir) {
  writeFileSync(join(dir, 'build.sh'), `#!/bin/sh\ncat <<'EOF'\n${BUILD_PROGRESS}\nFinished in 3.1s\nEOF\n`)
  chmodSync(join(dir, 'build.sh'), 0o755)
}

export const BUILD_RULE_FILES = [
  { path: 'index.json', text: JSON.stringify({ schemaVersion: 1, rules: [{ id: 'build-progress', file: 'rules/build-progress.js', transformation: 'noise-removal' }] }) },
  { path: 'rules/build-progress.js', text: `defineRule({ project(input, lc) {
  if (!input.argv || input.argv[0] !== './build.sh') return null
  return lc.keepLines(input.raw, line => !/^\\[\\s*\\d+\\/\\d+\\] Compiling /.test(line.text), n => '[' + n + ' progress lines omitted]\\n')
} })` },
]

export function adoptRules(lightcodeHome, files = BUILD_RULE_FILES) {
  const sorted = [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  const hash = createHash('sha256').update(sorted.map(file => `${JSON.stringify([file.path, Buffer.byteLength(file.text)])}\0${file.text}`).join(''), 'utf8').digest('hex')
  for (const file of files) {
    const path = join(lightcodeHome, 'rules', hash, ...file.path.split('/'))
    mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 })
    writeFileSync(path, file.text, { mode: 0o400 })
  }
  writeFileSync(join(lightcodeHome, 'rules', 'active.json'), JSON.stringify({ schemaVersion: 1, active: hash,
    history: [{ hash, parent: null, adoptedAt: new Date().toISOString(), rules: 1 }] }), { mode: 0o600 })
  return hash
}
