import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { projectStaticFilter } from '../src/filters/index.ts'
import { makeFilter } from '../src/filters/make.ts'
import { mavenFilter } from '../src/filters/maven.ts'

/** Real outputs captured on macOS (make 3.81, Maven 3.8.4, mypy, ruff, eslint 9); paths replaced by /repo and ~. */
const captured = new Map((JSON.parse(readFileSync(new URL('../../../conformance/economy/new-cases/build-lint.json', import.meta.url), 'utf8')) as {
  cases: { id: string; command: string; stdout: string; exitCode: number }[]
}).cases.map(item => [item.id.replace('captured/', ''), item]))
const real = (id: string) => captured.get(id)!

/** Every line of `raw` that is not one of the removed kinds appears in `text`, in order. */
function keepsAllBut(raw: string, text: string, removed: RegExp) {
  let at = 0
  for (const line of raw.split('\n').filter(line => line !== '' && !removed.test(line))) {
    const found = text.indexOf(line, at)
    expect(found, line).toBeGreaterThanOrEqual(0)
    at = found + line.length
  }
}

describe('make', () => {
  it('folds idle sub-make directory lines and up-to-date messages, keeping the directory of anything that ran', () => {
    const idle = makeFilter.project(real('make/w-nothing-to-do'))!
    expect(idle).toBe('[make: 4 "up to date" or "nothing to be done" messages and 12 directory lines of sub-makes with nothing to report omitted]\n')
    expect(makeFilter.project(real('make/nothing-to-do'))).toBe('[make: 4 "up to date" or "nothing to be done" messages omitted]\n')
    // A fresh build: only the idle docs/ sub-make goes; every compile line, warning and its directory stays.
    const fresh = real('make/w-fresh-build')
    const built = makeFilter.project(fresh)!
    expect(built).not.toContain("Entering directory `/repo/docs'")
    expect(built).toContain("make[1]: Entering directory `/repo/libs/core'\ncc -Wall -c core.c -o core.o\ncore.c:1:25: warning: unused variable 'unused'")
    keepsAllBut(fresh.stdout, built, /directory `\/repo\/docs'/u)
  })

  it('leaves a failed build whose sub-makes all reported something, and anything unpaired, as it is', () => {
    expect(makeFilter.project(real('make/w-compile-error'))).toBeUndefined()
    expect(makeFilter.project(real('make/fresh-build'))).toBeUndefined()
    // GNU make 4 quoting; an Entering line without its Leaving one.
    const gnu4 = "make: Entering directory '/repo'\nmake[1]: Entering directory '/repo/docs'\nmake[1]: Nothing to be done for 'all'.\nmake[1]: Leaving directory '/repo/docs'\nmake: Leaving directory '/repo'\n"
    expect(makeFilter.project({ command: 'make -C /repo', stdout: gnu4, exitCode: 0 })).toBe('[make: 1 "up to date" or "nothing to be done" messages and 4 directory lines of sub-makes with nothing to report omitted]\n')
    expect(makeFilter.project({ command: 'make', stdout: "make[1]: Leaving directory '/repo/docs'\n", exitCode: 0 })).toBeUndefined()
    // Not make, or make printing its database.
    expect(makeFilter.project({ command: 'cmake --build .', stdout: gnu4, exitCode: 0 })).toBeUndefined()
    expect(makeFilter.project({ command: 'make -p', stdout: gnu4, exitCode: 0 })).toBeUndefined()
  })
})

describe('maven', () => {
  it('folds artifact downloads and transfer progress, keeping every build, test and status line', () => {
    const first = real('mvn/first-test')
    const projected = mavenFilter.project(first)!
    expect(projected.length).toBeLessThan(first.stdout.length / 50)
    expect(projected).toMatch(/\[INFO\] --- maven-compiler-plugin:3\.1:compile \(default-compile\) @ ledger ---\n\[\d+ Maven download lines omitted\]\n/u)
    for (const kept of ['Tests run: 12, Failures: 0, Errors: 0, Skipped: 0', '[INFO] BUILD SUCCESS', '[INFO] Compiling 1 source file to /repo/target/classes']) expect(projected).toContain(kept)
    keepsAllBut(first.stdout, projected, /^(?:Download(?:ing|ed) from |Progress \(| +$)/u)
    // Batch mode prefixes transfers with [INFO]; an upload is a transfer too.
    const batch = ['[INFO] Scanning for projects...', ...Array.from({ length: 4 }, (_, i) => `[INFO] Downloading from central: https://repo.maven.apache.org/maven2/a/${i}.pom`),
      '[INFO] Uploaded to nexus: https://nexus/x.jar (1 kB at 2 kB/s)', '[ERROR] Failed to execute goal'].join('\n') + '\n'
    expect(mavenFilter.project({ command: './mvnw -B install', stdout: batch, exitCode: 1 })).toBe('[INFO] Scanning for projects...\n[5 Maven download lines omitted]\n[ERROR] Failed to execute goal\n')
  })

  it('leaves output without transfers, or that is not Maven\'s, as it is', () => {
    for (const id of ['mvn/second-test', 'mvn/failing-test', 'mvn/quiet-failing-test']) expect(mavenFilter.project(real(id)), id).toBeUndefined()
    const transfers = Array.from({ length: 5 }, (_, i) => `Downloading from central: https://repo/x/${i}.pom`).join('\n') + '\n'
    expect(mavenFilter.project({ command: 'mvn test', stdout: transfers, exitCode: 0 })).toBeUndefined()
    expect(mavenFilter.project({ command: 'gradle build', stdout: `[INFO] x\n${transfers}`, exitCode: 0 })).toBeUndefined()
  })
})

describe('mypy, ruff and eslint text', () => {
  it('pass through: every line is a finding, its code frame or its fix', () => {
    for (const id of ['lint/mypy', 'lint/ruff-check', 'lint/eslint']) expect(projectStaticFilter(real(id)), id).toBeUndefined()
  })
})
