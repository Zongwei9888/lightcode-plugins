# Connecting an agent to LightCode

LightCode is one core and a thin adapter per agent. The core (filters,
original store, journal, LightShadow checkpoints, recall, self-evolution)
does not know which agent it runs in. An adapter only translates: the
agent's events into the core's inputs, and the core's answers back into
what the agent expects. Users install only the adapter for their agent; the
`lc` command carries the handlers for every hook-based agent, and each one
runs only when that agent's hook calls it.

```
                ┌──────────── core (packages/core, mechanisms, store) ────────────┐
                │ filters · originals · journal · checkpoints · recall · evolve   │
                └──────────────────────────────┬───────────────────────────────────┘
                     in-process import         │        `lc` over stdin/stdout (JSON)
        ┌──────────────┬──────────────┬────────┴─────┬──────────────┬──────────────┐
        pi            DSH          OpenCode       Claude Code     Codex        Hermes …
```

## 1. Declare what the agent allows

Add a profile to `packages/protocol/src/hosts.ts`: the capabilities the
agent's plugin interface offers (`packages/protocol/src/capabilities.ts`
lists them) and notes a user should know. `negotiate` then decides, per
mechanism, `apply`, `observe` or `off`, and `lc doctor` shows why. You never
switch a mechanism on by hand: declare the capability and the mechanism
follows. Configuration can only lower a mode.

| Capability | What the agent must let a plugin do |
|---|---|
| `toolResults` / `toolResultsPreserveRaw` | replace a tool result before the model reads it |
| `commandWrapper` | rewrite a shell command before it runs (to `lc run …`) |
| `compaction` | write the compaction summary itself |
| `compactionContext` | add text to the conversation right after the agent compacts it |
| `tools` | give the model a tool (in-process, or an MCP server the agent loads) |

## 2. Economy: pick the deepest route the agent offers

1. **In process** (`toolResults`): build an `EconomyEngine` and call
   `process()` with the shell result; put the returned text where the agent
   reads the result. See `adapters/opencode/src/plugin.ts`.
2. **Result hook** (`toolResults` from a separate process): the hook hands the
   finished output to `lc hook <agent>`, which answers with the replacement.
   Add a handler to `packages/cli/src/hook.ts`. See `claudeHook`, `grokHook`,
   `hermesHook`.
3. **Command wrapper** (`commandWrapper`): rewrite the command to
   `lc run --host <agent> --session <id> --call <id> -c '<command>'` before it
   runs. See `codexPreToolUse`. Never answer a permission prompt on the
   user's behalf: the agent must check the command as the model wrote it.

Whatever the route: output the agent already cut, interrupted commands and
anything you cannot parse pass through unchanged (fail open).

## 3. LightShadow: three tiers

The core needs the span being compacted as a list of `ShadowMessage`s:

```json
[{"role": "user",      "text": "Fix the failing test."},
 {"role": "assistant", "text": "Running the tests."},
 {"role": "tool",      "text": "<the result exactly as the model read it>",
  "tool_name": "Bash", "call_id": "toolu_01…", "call": "pytest -x"},
 {"role": "summary",   "text": "<an earlier compaction summary>"}]
```

`call` is one line naming what produced the result (the command, the path
read); `callLabel(args)` builds it from the tool call's arguments. Any role
the agent has that is none of these becomes `other`: it is summarized but
never externalized.

| Tier | Agent capability | Adapter does | Core call |
|---|---|---|---|
| **Full** | `compaction` + `tools` | summarize the span with the agent's own summarizer plus `SHADOW_SUMMARY_INSTRUCTION`, then replace the summary with the checkpoint | `shadowCheckpoint()` · `lc shadow checkpoint` |
| **Assisted** | `compactionContext` + `tools` | keep the agent's summary; at compaction save the span and put the catalog into the context right after it | `shadowCatalog()` · `lc shadow catalog` |
| **Recall only** | `tools` | offer `lightcode_recall` | `recallFromJournal()` · `lc recall` · `lc mcp` |

Worked examples, one per seam:

| Agent | Tier | Seam | Where |
|---|---|---|---|
| pi | full | `session_before_compact` hands over the span and the summarizer | `adapters/pi/src/shadow.ts` |
| DeepSeek Harness | full | wraps each compaction engine's `summarize` | `adapters/dsh/src/shadow.ts` |
| OpenCode | full | `session.compacting` → `chat.messages.transform` (the span) → `text.complete` (the summary) | `adapters/opencode/src/shadow.ts` |
| Hermes Agent | full | a context engine subclassing Hermes's compressor; Python, so it calls `lc shadow checkpoint` | `adapters/hermes/lightcode/shadow.py` |
| CodeBuddy | full | a mod: `session.compact` (the span), `session.append` (rewrite the stored summary) | `adapters/codebuddy/hooks/lightshadow.js` |
| Claude Code | assisted | `SessionStart(compact)` reads the transcript and adds the catalog | `packages/cli/src/claude-shadow.ts` |
| Codex | assisted | `SessionStart(compact)` reads the rollout and adds the catalog | `packages/cli/src/codex-shadow.ts` |
| Grok Build | assisted | `PostCompact` reads the span; the next `PostToolUse` or `Stop` adds the catalog | `packages/cli/src/grok-shadow.ts` |

Pass a call's raw arguments as `call_input` and `lc` labels it for you.

`lc shadow checkpoint` reads `{host, session_id, messages, summary, prior?}`
and prints `{"text": …}`; `lc shadow catalog` reads `{host, session_id,
messages, tool_name?, budget_tokens?}` and prints `{"text": …}`. A `null`
text means: keep the agent's own result. Both journal what they did, so
`lc report` and the recall tool see it.

The recall tool: in process, declare `RECALL_TOOL_NAME`,
`RECALL_TOOL_DESCRIPTION` and `RECALL_INPUT_SCHEMA` and answer with
`recallFromJournal()`. Otherwise ship the MCP server, `lc mcp --host
<agent>`, in the agent's MCP configuration; it finds references by their
content-derived IDs, so it needs no session ID. Tell the catalog the tool
name the model sees (MCP tools are often prefixed), with `tool_name`.

Fail open: on any error, timeout or `null`, the agent's own compaction
stands. Never block a compaction.

## 4. Test it

- Unit tests with payloads captured from the real agent (`packages/cli/test/hooks.spec.ts` shows the pattern). Record the agent version the payloads came from: shapes change between versions, and an unknown shape must pass through, not throw.
- One real run per mechanism, as in the README's *How it is tested*: a pytest run for Economy; for LightShadow, read ten files, force a compaction with a low threshold, then ask for a value that only a recall can return.

## Any other agent

Without an adapter, an agent still gets most of LightCode:

- **Economy**: run commands through `lc run -c '<command>'` (or tell the agent to, in its `AGENTS.md`).
- **Recall**: add `lc mcp` as an MCP server; the agent can then read any result LightShadow kept, by `observation_id`.
