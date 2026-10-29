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
      'its own grep and find results are laid out losslessly (rows by file, paths by directory)',
      'subagent pi processes inherit LIGHTCODE_PARENT_SESSION, so a session reports what its subagents saved',
    ],
  },
  codex: {
    id: 'codex', name: 'OpenAI Codex CLI (0.162+)', integration: 'hooks',
    capabilities: [...local, 'toolCalls', 'commandWrapper', 'compactionShaping', 'compactionContext', 'tools', 'models', 'sessions'],
    notes: [
      'PreToolUse rewrites recognized shell commands to `lc run`; the model history keeps the original command',
      'plugin hooks run only after the user trusts them (/hooks), again after each plugin update; rewritten commands still go through approval',
      'LightShadow, assisted: Codex writes the summary; SessionStart(compact) adds the catalog of the tool results LightCode kept, and the plugin\'s MCP server offers mcp__lightcode__lightcode_recall (read-only, so exec runs it without asking)',
      'subagent threads get no SessionStart(compact), so no catalog',
    ],
  },
  claude: {
    id: 'claude', name: 'Claude Code (2.1+)', integration: 'hooks',
    capabilities: [...local, 'toolResults', 'commandWrapper', 'compactionShaping', 'compactionContext', 'tools', 'models', 'sessions'],
    notes: [
      'PostToolUse replaces the output of a successful Bash call; failed calls go to PostToolUseFailure, which cannot replace it',
      'in bypassPermissions mode PreToolUse wraps recognized commands in `lc run`, so failed calls are filtered too; other modes never rewrite a command, which would no longer match permission rules',
      'LightShadow, assisted: Claude Code writes the summary (PreCompact adds a line to its instructions); SessionStart(compact) adds the catalog, under its 10,000-character limit; the plugin\'s MCP server offers mcp__plugin_lightcode_lightcode__lightcode_recall',
    ],
  },
  codebuddy: {
    id: 'codebuddy', name: 'CodeBuddy Code (2.175+)', integration: 'hooks',
    capabilities: [...local, 'toolCalls', 'commandWrapper', 'compaction', 'tools', 'models', 'sessions'],
    notes: [
      'PreToolUse wraps recognized commands in `lc run` with no permission decision, so CodeBuddy\'s own permission check still runs',
      'its PostToolUse event carries no command output, so results cannot be replaced after the fact',
      'LightShadow through the plugin\'s mod: session.compact reads the span, session.append turns the stored summary into the checkpoint; lightcode_recall is a mod tool',
    ],
  },
  grok: {
    id: 'grok', name: 'Grok Build (1.0+)', integration: 'hooks',
    capabilities: [...local, 'toolResults', 'toolResultsPreserveRaw', 'compactionContext', 'tools', 'models', 'sessions'],
    notes: [
      'PostToolUse replaces the model\'s copy of a shell result, failed commands included; the scrollback and transcript keep the original',
      'LightShadow, assisted: Grok writes the summary and lets nothing in at compaction; PostCompact saves the span, the next tool result (or Stop) carries the catalog; the MCP tool lightcode__lightcode_recall is reached through use_tool',
      'results Grok already cut, and results over 128 KiB, pass through',
      'hooks run only in trusted folders; `grok -p` counts its folder as trusted',
    ],
  },
  hermes: {
    id: 'hermes', name: 'Hermes Agent (0.22+)', integration: 'hooks',
    // Hermes also offers argument rewrites (pre_tool_call); the adapter does not use them.
    capabilities: [...local, 'toolResults', 'compaction', 'tools', 'models', 'sessions'],
    notes: [
      'LightShadow as a context engine (`hermes config set context.engine lightcode`): Hermes\'s own compressor, whose summary becomes the checkpoint; lightcode_recall is an engine tool',
      'its plugin hands transform_terminal_output to `lc hook hermes`: the terminal output is replaced before Hermes limits, strips and redacts it',
      'output Hermes cut to a head and tail, and commands it stopped, pass through; background-process output is left alone',
    ],
  },
  opencode: {
    id: 'opencode', name: 'OpenCode (1.19+)', integration: 'in-process',
    capabilities: [...local, 'toolResults', 'compaction', 'compactionShaping', 'tools', 'models', 'sessions'],
    notes: [
      'tool.execute.after replaces the bash result before OpenCode stores it and the model reads it; LightCode keeps the original',
      'LightShadow through the experimental compaction hooks (session.compacting, chat.messages.transform, text.complete): the summary becomes the checkpoint; lightcode_recall is a plugin tool',
      'stdout and stderr arrive merged; output OpenCode already cut to its tail passes through',
      'commands run as the model wrote them, so permissions are untouched',
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
      'complete results of its own grep and glob are laid out losslessly; searches DSH capped pass through',
      'in-process subagents (subagent, subagent_fork) are filtered too and counted in their parent session',
    ],
  },
  shell: {
    id: 'shell', name: 'Any agent or terminal via `lc run`', integration: 'command',
    capabilities: [...local, 'commandWrapper'],
    notes: ['the agent (or you) must call `lc run -c <command>` explicitly'],
  },
})
