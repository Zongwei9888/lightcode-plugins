import type { Capability } from './capabilities.ts'

export interface HostProfile {
  readonly id: string
  readonly name: string
  readonly integration: 'in-process' | 'hooks' | 'command'
  /** What the host offers to LightCode without patches. */
  readonly capabilities: readonly Capability[]
  readonly notes: readonly string[]
}

const local: Capability[] = ['journal', 'artifacts', 'tokens']

/** Capability profiles of supported hosts, as verified against their sources. */
export const HOST_PROFILES: Readonly<Record<string, HostProfile>> = Object.freeze({
  pi: {
    id: 'pi', name: 'pi coding agent (@earendil-works/pi-coding-agent 1.x)', integration: 'in-process',
    capabilities: [...local, 'toolResults', 'toolResultsPreserveRaw', 'toolCalls', 'compaction', 'context', 'tools', 'toolVisibility', 'models', 'sessions', 'ui'],
    notes: [
      'turn_end context_edit replaces what the model sees; the session file keeps the original',
      'bash merges stdout and stderr; outputs pi already truncated (2000 lines / 50KB) pass through',
    ],
  },
  codex: {
    id: 'codex', name: 'OpenAI Codex CLI (0.162+)', integration: 'hooks',
    capabilities: [...local, 'toolCalls', 'commandWrapper', 'compactionShaping', 'tools', 'models', 'sessions'],
    notes: [
      'PreToolUse rewrites recognized shell commands to `lc run`; the model history keeps the original command',
      'plugin hooks run only after the user trusts them (/hooks); rewritten commands still go through approval',
      'compaction cannot be supplied by a plugin, only shaped',
    ],
  },
  dsh: {
    id: 'dsh', name: 'DeepSeek Harness (0.2.x)', integration: 'in-process',
    capabilities: [...local, 'toolResults', 'toolCalls', 'compaction', 'tools', 'models', 'sessions', 'ui'],
    notes: ['adapter for 0.2.x is not released yet'],
  },
  shell: {
    id: 'shell', name: 'Any agent or terminal via `lc run`', integration: 'command',
    capabilities: [...local, 'commandWrapper'],
    notes: ['the agent (or you) must call `lc run -c <command>` explicitly'],
  },
})
