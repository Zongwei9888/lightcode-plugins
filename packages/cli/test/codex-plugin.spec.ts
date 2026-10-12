import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../../../adapters/codex/', import.meta.url)
const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'))

describe('Codex plugin layout', () => {
  it('declares one PreToolUse hook on the Bash tool name that calls lc', () => {
    const manifest = json('.codex-plugin/plugin.json')
    expect(manifest).toMatchObject({ name: 'lightcode', hooks: './hooks/hooks.json' })
    const hooks = json('hooks/hooks.json')
    expect(Object.keys(hooks).sort()).toEqual(['description', 'hooks'])
    expect(hooks.hooks).toEqual({ PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'lc hook codex', timeout: 10 }] }] })
  })
})
