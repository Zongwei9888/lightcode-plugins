import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = new URL('../../../', import.meta.url)
const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'))
const version = json('packages/cli/package.json').version as string
const hook = (host: string) => [{ type: 'command', command: `tokenwise hook ${host}`, timeout: 10 }]
const check = [{ type: 'command', command: expect.stringContaining('command -v tokenwise'), timeout: 5 }]
const PLUGINS = ['adapters/claude-code', 'adapters/codex', 'adapters/codebuddy', 'adapters/grok']

describe('Claude Code, CodeBuddy and Grok plugin layouts', () => {
  it('lists one plugin per host in that host\'s marketplace file', () => {
    // CodeBuddy reads .codebuddy-plugin before .claude-plugin, and Grok .grok-plugin before it, so each finds its own.
    expect(json('.claude-plugin/marketplace.json').plugins).toMatchObject([{ name: 'tokenwise', source: './adapters/claude-code', version }])
    expect(json('.codebuddy-plugin/marketplace.json').plugins).toMatchObject([{ name: 'tokenwise', source: './adapters/codebuddy', version }])
    expect(json('.grok-plugin/marketplace.json').plugins).toMatchObject([{ name: 'tokenwise', source: { type: 'local', path: './adapters/grok' }, version }])
    for (const manifest of ['adapters/claude-code/.claude-plugin/plugin.json', 'adapters/codebuddy/.codebuddy-plugin/plugin.json', 'adapters/grok/plugin.json']) {
      expect(json(manifest)).toMatchObject({ name: 'tokenwise', version })
    }
  })

  it('calls tokenwise with the host\'s own name, on the events that host can use', () => {
    expect(json('adapters/claude-code/hooks/hooks.json').hooks).toEqual({
      PreToolUse: [{ matcher: 'Bash', hooks: hook('claude') }, { matcher: 'mcp__plugin_tokenwise_tokenwise__tokenwise_recall', hooks: hook('claude') }],
      PostToolUse: [{ matcher: 'Bash', hooks: hook('claude') }],
      PreCompact: [{ hooks: hook('claude') }],
      SessionStart: [{ matcher: 'startup', hooks: check }, { matcher: 'compact', hooks: [{ type: 'command', command: 'tokenwise hook claude', timeout: 60 }] }],
    })
    // The recall tool's name is mcp__plugin_<plugin>_<server>__<tool>; the PreToolUse matcher above must follow it.
    expect(json('adapters/claude-code/.mcp.json').mcpServers).toEqual({ tokenwise: { command: 'tokenwise', args: ['mcp', '--host', 'claude'], alwaysLoad: true } })
    expect(json('adapters/codebuddy/hooks/hooks.json').hooks).toEqual({ PreToolUse: [{ matcher: 'Bash', hooks: hook('codebuddy') }],
      SessionStart: [{ matcher: 'startup', hooks: check }] })
    // LightShadow on CodeBuddy is a mod: an ES module the plugin's hooks.json lists.
    expect(json('adapters/codebuddy/hooks/hooks.json').modules).toEqual(['./compaction.js'])
    expect(json('adapters/codebuddy/package.json')).toMatchObject({ type: 'module' })
    // Grok: every PostToolUse (the catalog rides the first tool result after a compaction), PostCompact and Stop.
    expect(json('adapters/grok/hooks/hooks.json').hooks).toEqual({ SessionStart: [{ hooks: check }], PostToolUse: [{ hooks: hook('grok') }],
      PostCompact: [{ hooks: [{ type: 'command', command: 'tokenwise hook grok', timeout: 60 }] }], Stop: [{ hooks: hook('grok') }] })
    // Grok names MCP tools <server key>__<tool>: tokenwise__tokenwise_recall.
    expect(json('adapters/grok/.mcp.json').mcpServers).toEqual({ tokenwise: { command: 'tokenwise', args: ['mcp', '--host', 'grok'] } })
  })

  it('tells the user at startup when the tokenwise command is missing, and stays quiet when it is there', () => {
    const bin = mkdtempSync(join(tmpdir(), 'tokenwise-path-'))
    try {
      writeFileSync(join(bin, 'tokenwise'), '#!/bin/sh\n')
      chmodSync(join(bin, 'tokenwise'), 0o755)
      for (const plugin of PLUGINS) {
        const command = json(`${plugin}/hooks/hooks.json`).hooks.SessionStart[0].hooks[0].command as string
        const missing = spawnSync('/bin/sh', ['-c', command], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' })
        expect(missing.status).toBe(0)
        expect(JSON.parse(missing.stdout).systemMessage).toMatch(/^TokenWise: the tokenwise command is not on PATH.*#install$/)
        const present = spawnSync('/bin/sh', ['-c', command], { env: { PATH: `${bin}:/usr/bin:/bin` }, encoding: 'utf8' })
        expect(present).toMatchObject({ status: 0, stdout: '' })
      }
    } finally { rmSync(bin, { recursive: true, force: true }) }
  })
})
