// Capture real tool outputs in a throwaway sandbox for the LightCode conformance corpus.
// Usage: node capture-inputs.mjs <empty-sandbox-dir> <out.json> <lightcode-repo>
// Requires git, grep, find, ls, pytest, cargo and node. Absolute sandbox/home paths
// and the local user name are replaced so captured outputs carry no personal data.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, copyFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { userInfo } from 'node:os'

const [, , sandbox, out, repo] = process.argv
rmSync(sandbox, { recursive: true, force: true })
mkdirSync(sandbox, { recursive: true })
const w = (path, text) => { mkdirSync(join(sandbox, path, '..'), { recursive: true }); writeFileSync(join(sandbox, path), text) }
const env = { PATH: process.env.PATH, HOME: process.env.HOME, LC_ALL: 'C', LANG: 'C', TERM: 'dumb', GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z', CARGO_TERM_COLOR: 'never', CARGO_HOME: process.env.CARGO_HOME ?? join(process.env.HOME, '.cargo'),
  RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(process.env.HOME, '.rustup'), PYTHONDONTWRITEBYTECODE: '1' }
const sh = (cmd, cwd = sandbox) => execFileSync('/bin/sh', ['-c', cmd], { cwd, env, stdio: 'ignore' })

// Source tree for search/listing commands.
for (let d = 0; d < 6; d++) for (let f = 0; f < 8; f++) {
  const lines = Array.from({ length: 60 }, (_, i) => i % 3 === 0 ? `export const value${i} = compute(${i}) // value marker ${d}-${f}-${i}` : `const other${i} = ${i}`)
  w(`src/module-${d}/component-${f}.ts`, lines.join('\n') + '\n')
}
w('src/中文目录/说明.ts', Array.from({ length: 30 }, (_, i) => `// value 中文注释 ${i} 😀`).join('\n') + '\n')
// git repository with a large diff, modified and untracked files.
sh('git init -q -b main && git config color.ui false && git config advice.statusHints true && git add -A && git commit -q -m init')
for (let f = 0; f < 4; f++) w(`src/module-0/component-${f}.ts`, Array.from({ length: 260 }, (_, i) => `export const changed${i} = ${i * f} // rewritten line ${i}`).join('\n') + '\n')
w('src/module-1/new-file.ts', 'export const fresh = 1\n')
w('notes/todo.txt', 'untracked\n')
// Python tests: many passing, one failing.
w('py/test_numbers.py', Array.from({ length: 45 }, (_, i) => `def test_case_${i}():\n    assert ${i} + 1 == ${i + 1}\n`).join('\n')
  + '\ndef test_failure():\n    expected = 42\n    assert expected == 41, "important failure evidence"\n')
// TypeScript diagnostics.
w('ts/bad.ts', Array.from({ length: 25 }, (_, i) => `const n${i}: number = 'text ${i}'`).join('\n') + '\nexport {}\n')
w('ts/tsconfig.json', '{"compilerOptions":{"strict":true,"noEmit":true,"types":[]},"files":["bad.ts"]}\n')
// Rust crate with many tests and one failure.
mkdirSync(join(sandbox, 'crate/src'), { recursive: true })
w('crate/Cargo.toml', '[package]\nname = "fixture_crate"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n')
w('crate/src/lib.rs', 'pub fn add(a: u32, b: u32) -> u32 { a + b }\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n'
  + Array.from({ length: 70 }, (_, i) => `    #[test]\n    fn case_${i}() { assert_eq!(add(${i}, 1), ${i + 1}); }\n`).join('')
  + '    #[test]\n    fn failure() { assert_eq!(add(2, 2), 5, "important rust evidence"); }\n}\n')
copyFileSync(join(repo, 'packages/core/test/fixtures/node-tap-fixture.mjs'), join(sandbox, 'tap-fixture.test.mjs'))
const tsc = join(repo, 'node_modules/.bin/tsc')

const commands = [
  ['grep -rn value src', 'grep'], ['grep -rn "value marker" src/module-2', 'grep'],
  ['grep -rn nothing-matches-here src', 'grep'],
  ['find src -type f', 'path-list'], ['find . -name "*.ts" -type f', 'path-list'],
  ['ls -la src/module-3', 'ls-listing'], ['ls -la src', 'ls-listing'],
  ['git status', 'git-status'], ['git diff', 'git-diff'], ['git diff --stat', 'git-diff'], ['git log --oneline -5', 'git'],
  ['pytest py', 'pytest'], ['python3 -m pytest py', 'pytest'], ['pytest -q py', 'pytest'], ['pytest --color=no py/test_numbers.py', 'pytest'],
  ['cd ts && tsc', 'tsc', { cwd: 'ts', run: `${tsc} -p .` }],
  ['cd crate && cargo build', 'cargo-build', { cwd: 'crate', run: 'cargo build --offline' }],
  ['cd crate && cargo test', 'test-report', { cwd: 'crate', run: 'cargo test --offline' }],
  ['node --test --test-reporter=tap tap-fixture.test.mjs', 'test-report'],
  ['node --test tap-fixture.test.mjs', 'test-report'],
  ['cat src/module-0/component-0.ts', 'none'], ['wc -l src/module-0/component-1.ts', 'none'],
]
const clean = text => text.split(realpathSync(sandbox)).join('/work/fixture').split(sandbox).join('/work/fixture')
  .split(process.env.HOME).join('/home/user').split(` ${userInfo().username} `).join(' dev ')
const cases = []
for (const [command, family, extra] of commands) {
  const cwd = extra?.cwd ? join(sandbox, extra.cwd) : sandbox
  const result = spawnSync('/bin/sh', ['-c', extra?.run ?? command], { cwd, env, encoding: 'utf8', maxBuffer: 64 << 20 })
  cases.push({ id: `captured/${cases.length.toString().padStart(2, '0')}-${family}`, source: 'captured', command,
    stdout: clean(result.stdout), stderr: clean(result.stderr), exitCode: result.status ?? -1 })
}
writeFileSync(out, JSON.stringify(cases, null, 1) + '\n')
console.log(cases.map(c => `${c.id} exit=${c.exitCode} out=${c.stdout.length} err=${c.stderr.length}`).join('\n'))
