import { chmodSync, mkdtempSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readRuleDirectory, removeTree, RuleStore } from '../src/index.ts'

const dirs: string[] = []
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'tokenwise-rules-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) removeTree(dir) })

function ruleDir(name = 'x', body = "defineRule({ project() { return null } })") {
  const dir = temp()
  mkdirSync(join(dir, 'rules'))
  writeFileSync(join(dir, 'index.json'), JSON.stringify({ schemaVersion: 1, rules: [{ id: name, file: `rules/${name}.js` }] }))
  writeFileSync(join(dir, 'rules', `${name}.js`), body)
  return dir
}

describe('RuleStore', () => {
  it('installs read-only by content hash, activates, rolls back and switches off', () => {
    const store = new RuleStore(temp())
    expect(store.state()).toEqual({ schemaVersion: 1, active: null, history: [] })
    expect(store.load()).toBeUndefined()
    const first = store.install(ruleDir('a'))
    expect(store.install(ruleDir('a'))).toBe(first)
    expect(statSync(join(store.dirOf(first), 'rules', 'a.js')).mode & 0o777).toBe(0o400)
    store.activate(first, { cases: 3, gainTokens: 120 })
    expect(store.load()?.hash).toBe(first)
    const second = store.install(ruleDir('b'))
    store.activate(second)
    expect(store.state()).toMatchObject({ active: second, history: [{ hash: first, parent: null, cases: 3, gainTokens: 120, rules: 1 }, { hash: second, parent: first }] })
    expect(store.load()?.rules.map(rule => rule.id)).toEqual(['b'])
    expect(store.rollback()).toBe(first)
    expect(store.load()?.rules.map(rule => rule.id)).toEqual(['a'])
    expect(store.rollback()).toBeNull()
    expect(store.load()).toBeUndefined()
    store.activate(second)
    store.deactivate()
    expect(store.state().active).toBeNull()
    // Switching on restores what was in use when switched off, even when that is not the last adoption.
    expect(store.rollback()).toBe(second)
    store.activate(first)
    store.activate(second)
    expect(store.rollback()).toBe(first)
    store.deactivate()
    expect(store.state()).toMatchObject({ active: null, paused: first })
    expect(store.rollback()).toBe(first)
    expect(store.state().paused).toBeUndefined()
  })

  it('refuses rules changed on disk, links, and malformed directories', () => {
    const store = new RuleStore(temp())
    const hash = store.install(ruleDir('a'))
    store.activate(hash)
    const file = join(store.dirOf(hash), 'rules', 'a.js')
    chmodSync(file, 0o600)
    writeFileSync(file, "defineRule({ project() { return null } }) // changed")
    const errors: unknown[] = []
    // A fresh store (no cache) reads the files again and finds the change.
    expect(new RuleStore(join(store.root, '..')).load(error => errors.push(error))).toBeUndefined()
    expect(String(errors[0])).toMatch(/changed on disk/)
    expect(() => store.activate(hash)).toThrow(/changed on disk/)

    const linked = ruleDir('l')
    symlinkSync('/etc/hosts', join(linked, 'rules', 'link.js'))
    expect(() => readRuleDirectory(linked)).toThrow(/symbolic links/)
    const bad = temp()
    writeFileSync(join(bad, 'index.json'), '{"schemaVersion":1}')
    expect(() => store.install(bad)).toThrow(/schemaVersion/)
    expect(() => store.dirOf('../../etc')).toThrow(/not a rule directory hash/)
  })

  it('checks out the active rules (or an empty directory) for a learner to edit', () => {
    const store = new RuleStore(temp())
    const empty = join(temp(), 'work')
    expect(store.checkout(empty)).toBeNull()
    expect(JSON.parse(readFileSync(join(empty, 'index.json'), 'utf8'))).toEqual({ schemaVersion: 1, rules: [] })
    const hash = store.install(ruleDir('a'))
    store.activate(hash)
    const work = join(temp(), 'work')
    expect(store.checkout(work)).toBe(hash)
    writeFileSync(join(work, 'rules', 'a.js'), '// editable')
    expect(readRuleDirectory(store.dirOf(hash)).find(item => item.path === 'rules/a.js')!.text).not.toBe('// editable')
  })
})
