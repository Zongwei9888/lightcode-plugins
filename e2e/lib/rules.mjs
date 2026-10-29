/**
 * Adopt a learned rule directly in a LightCode home, the way `lc evolve`
 * leaves it: `<home>/rules/<hash>/` and `rules/active.json`. The hash is the
 * content hash LightCode verifies on load.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const BUILD_PROGRESS = Array.from({ length: 120 }, (_, i) => `[${String(i + 1).padStart(3)}/120] Compiling module_${i}`).join('\n')
export const BUILD_LEARNED = 'Finished in 3.1s\n[120 progress lines omitted]\n'

/** A learned projection as the model reads it: the projection, then the line naming its original (a host footer may follow). */
export function assertLearned(text, projection = BUILD_LEARNED) {
  assert.ok(typeof text === 'string' && text.startsWith(projection), `the learned rule did not apply: ${text}`)
  assert.match(text.slice(projection.length), /^\[LightCode shortened this output\. The complete output is observation o-[0-9a-f]{12}: /)
}

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

/** Linker progress no filter knows; each run differs (a counter), so the learner sees some runs and the checker holds others back. */
export function writeLinkScript(dir) {
  writeFileSync(join(dir, 'link.sh'), `#!/bin/sh
n=$(cat .link-runs 2>/dev/null || echo 0); n=$((n + 1)); echo $n > .link-runs
i=1
while [ $i -le 150 ]; do printf '[%3d/150] Linking target_%d (run %d)\\n' $i $i $n; i=$((i + 1)); done
echo "Linked 150 targets"
`)
  chmodSync(join(dir, 'link.sh'), 0o755)
}

/**
 * What a learner does in its workspace: keep the rules it was given (already
 * in rules-work), add one for the linker progress, run ./check.
 */
export function linkLearnerCommand(kept = []) {
  const entries = [...kept, 'link-progress'].map(id => `{ "id": "${id}", "file": "rules/${id}.js", "transformation": "noise-removal" }`).join(',\n  ')
  return `mkdir -p rules-work/rules
cat > rules-work/rules/link-progress.js <<'JS'
defineRule({ project(input, lc) {
  if (!input.argv || input.argv[0] !== './link.sh') return null
  return lc.keepLines(input.raw, line => !/^\\[\\s*\\d+\\/\\d+\\] Linking /.test(line.text), n => '[' + n + ' link progress lines omitted]\\n')
} })
JS
cat > rules-work/index.json <<'JSON'
{ "schemaVersion": 1, "rules": [
  ${entries} ] }
JSON
./check`
}
