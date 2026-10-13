/**
 * A small, deterministic project whose commands exercise LightCode the way a
 * coding session does: a recursive search, a failing test run, a diff, and a
 * command no filter covers. Only Node.js and git are required.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const COMMANDS = {
  search: 'grep -rn value src',
  tests: 'node --test --test-reporter=tap failing.test.mjs',
  diff: 'git diff',
  plain: 'echo hello from the fixture',
  // ~56 KB: under DSH's 64 KB stream cap, over its spill threshold (12,500 tokens).
  wide: 'grep -rn value wide',
  // TAP on stdout and a second report on stderr: the projection must leave the stderr section intact.
  testsWithStderr: 'node --test --test-reporter=tap --test-reporter-destination=stdout --test-reporter=dot --test-reporter-destination=stderr failing.test.mjs',
}

export function createFixture(dir) {
  mkdirSync(join(dir, 'src'), { recursive: true })
  const write = () => {
    for (let f = 0; f < 3; f++) {
      writeFileSync(join(dir, 'src', `f${f}.ts`), Array.from({ length: 90 }, (_, i) => `export const value${i} = ${i} // value line`).join('\n') + '\n')
    }
  }
  write()
  mkdirSync(join(dir, 'wide'))
  for (let f = 0; f < 10; f++) {
    writeFileSync(join(dir, 'wide', `w${f}.ts`), Array.from({ length: 100 }, (_, i) => `export const value${i} = ${i} // a wide value line`).join('\n') + '\n')
  }
  writeFileSync(join(dir, 'failing.test.mjs'), "import test from 'node:test'\nimport assert from 'node:assert'\n"
    + Array.from({ length: 40 }, (_, i) => `test('passes ${i}', () => {})\n`).join('')
    + "test('fails', () => { assert.strictEqual(1, 2, 'necessary failure evidence') })\n")
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore',
    env: { ...process.env, GIT_AUTHOR_NAME: 'e2e', GIT_AUTHOR_EMAIL: 'e2e@example.invalid', GIT_COMMITTER_NAME: 'e2e', GIT_COMMITTER_EMAIL: 'e2e@example.invalid' } })
  git('init', '-q')
  git('add', '-A')
  git('commit', '-q', '-m', 'fixture')
  // A wide diff: every line of every file changes.
  for (let f = 0; f < 3; f++) {
    writeFileSync(join(dir, 'src', `f${f}.ts`), Array.from({ length: 90 }, (_, i) => `export const value${i} = ${i * 2} // changed value line`).join('\n') + '\n')
  }
  return dir
}
