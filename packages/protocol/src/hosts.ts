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
    // 0.2 excludes argument rewriting from tools/pre-execute (arguments are logged before it runs).
    capabilities: [...local, 'toolResults', 'compaction', 'tools', 'models', 'sessions', 'ui'],
    notes: [
      'tools/post-execute replaces the bash result the model and the session log receive; LightCode keeps the original',
      'stdout and stderr stay apart; output DSH already cut to its tail (64 KB per stream by default) passes through',
      'tool arguments cannot be rewritten before execution, so command normalization is off',
    ],
  },
  shell: {
    id: 'shell', name: 'Any agent or terminal via `lc run`', integration: 'command',
    capabilities: [...local, 'commandWrapper'],
    notes: ['the agent (or you) must call `lc run -c <command>` explicitly'],
  },
})
