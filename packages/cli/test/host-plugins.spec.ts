import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../../../', import.meta.url)
const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'))
const version = json('packages/cli/package.json').version as string
const hook = (host: string) => [{ type: 'command', command: `lc hook ${host}`, timeout: 10 }]

describe('Claude Code, CodeBuddy and Grok plugin layouts', () => {
  it('lists one plugin per host in that host\'s marketplace file', () => {
    // CodeBuddy reads .codebuddy-plugin before .claude-plugin, and Grok .grok-plugin before it, so each finds its own.
    expect(json('.claude-plugin/marketplace.json').plugins).toMatchObject([{ name: 'lightcode', source: './adapters/claude-code', version }])
    expect(json('.codebuddy-plugin/marketplace.json').plugins).toMatchObject([{ name: 'lightcode', source: './adapters/codebuddy', version }])
    expect(json('.grok-plugin/marketplace.json').plugins).toMatchObject([{ name: 'lightcode', source: { type: 'local', path: './adapters/grok' }, version }])
    for (const manifest of ['adapters/claude-code/.claude-plugin/plugin.json', 'adapters/codebuddy/.codebuddy-plugin/plugin.json', 'adapters/grok/plugin.json']) {
      expect(json(manifest)).toMatchObject({ name: 'lightcode', version })
    }
  })

  it('calls lc with the host\'s own name, on the events that host can use', () => {
    expect(json('adapters/claude-code/hooks/hooks.json').hooks).toEqual({
      PreToolUse: [{ matcher: 'Bash', hooks: hook('claude') }, { matcher: 'mcp__plugin_lightcode_lightcode__lightcode_recall', hooks: hook('claude') }],
      PostToolUse: [{ matcher: 'Bash', hooks: hook('claude') }],
      PreCompact: [{ hooks: hook('claude') }],
      SessionStart: [{ matcher: 'compact', hooks: [{ type: 'command', command: 'lc hook claude', timeout: 60 }] }],
    })
    // The recall tool's name is mcp__plugin_<plugin>_<server>__<tool>; the PreToolUse matcher above must follow it.
    expect(json('adapters/claude-code/.mcp.json').mcpServers).toEqual({ lightcode: { command: 'lc', args: ['mcp', '--host', 'claude'], alwaysLoad: true } })
    expect(json('adapters/codebuddy/hooks/hooks.json').hooks).toEqual({ PreToolUse: [{ matcher: 'Bash', hooks: hook('codebuddy') }] })
    // LightShadow on CodeBuddy is a mod: an ES module the plugin's hooks.json lists.
    expect(json('adapters/codebuddy/hooks/hooks.json').modules).toEqual(['./lightshadow.js'])
    expect(json('adapters/codebuddy/package.json')).toMatchObject({ type: 'module' })
    // Grok: every PostToolUse (the catalog rides the first tool result after a compaction), PostCompact and Stop.
    expect(json('adapters/grok/hooks/hooks.json').hooks).toEqual({ PostToolUse: [{ hooks: hook('grok') }],
      PostCompact: [{ hooks: [{ type: 'command', command: 'lc hook grok', timeout: 60 }] }], Stop: [{ hooks: hook('grok') }] })
    // Grok names MCP tools <server key>__<tool>: lightcode__lightcode_recall.
    expect(json('adapters/grok/.mcp.json').mcpServers).toEqual({ lightcode: { command: 'lc', args: ['mcp', '--host', 'grok'] } })
  })
})
