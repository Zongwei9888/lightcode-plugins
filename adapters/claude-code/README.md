# LightCode for Claude Code

A Claude Code plugin with two hooks on the `Bash` tool, both running
`lc hook claude`:

- **`PostToolUse`** replaces the output of a successful Bash call with
  LightCode's projection when a filter recognizes it (test runners,
  compilers, `git status/diff`, `grep`/`rg`, `find`, `ls`, build tools, …).
  The command runs exactly as the model wrote it; the original output is
  saved under `~/.lightcode`.
- **`PreToolUse`**, in `bypassPermissions` mode only, wraps a recognizable
  command as `lc run --host claude --session <id> --call <id> -c '<command>'`,
  so failed calls are filtered too (see below).

Verified against Claude Code 2.1.310 in real `claude -p` sessions:

- A passing `pytest -v` run (150 tests): the model read 575 bytes instead of
  12,658, and answered from them. In `bypassPermissions` mode a failing run
  went from 13,328 to 1,245 bytes, keeping the failing test's node id and
  assertion. In both, the model's history keeps the original command.
- Claude Code sends a failed call (non-zero exit) to `PostToolUseFailure`,
  which cannot replace output, so outside `bypassPermissions` failed calls
  reach the model unchanged.
- Commands are never rewritten outside `bypassPermissions`: a wrapped command
  would no longer match your permission rules (`Bash(pytest:*)` would not
  match `lc run … -c 'pytest'`, and neither would Claude Code's built-in
  read-only commands), so it would prompt where it did not before, and a deny
  rule would stop matching. The hook never returns a permission decision.
- Claude Code's transcript keeps what the model read (the projection);
  `lc show <sha256>` prints the original.
- Grok and CodeBuddy also run Claude Code hooks. `lc hook claude` recognizes
  their events and leaves them to their own LightCode plugin, so nothing is
  filtered twice.
- `lc` must be on the `PATH` Claude Code runs hooks with
  (`npm install -g @lightcode-ai/cli`, then `lc doctor`).

## LightShadow (assisted)

Claude Code writes the compaction summary itself and no plugin may replace
it, so LightShadow works around it (verified on 2.1.312):

- **PreCompact** adds one paragraph to the summarizer's instructions: keep
  the findings, the tool results stay recoverable.
- **SessionStart** with source `compact` reads the transcript, saves every
  tool result of the span Claude Code just compacted (the subagent's
  transcript when a subagent compacted), and adds the catalog of everything
  the session can recall, under Claude Code's 10,000-character limit for
  added context. It is stored in the transcript, so it survives a resume.
- The plugin's MCP server (`.mcp.json`: `lc mcp --host claude`, always
  loaded) gives the model `mcp__plugin_lightcode_lightcode__lightcode_recall`;
  a PreToolUse hook lets it run without a prompt, since it only reads what
  LightCode saved.

In a real run (Haiku, compaction forced at ~35k tokens) the model answered a
question about a file it no longer had in context by calling the recall tool.

## Install

From a checkout of this repository (it doubles as a Claude Code marketplace):

```sh
claude plugin marketplace add /path/to/lightcode-plugins
claude plugin install lightcode@lightcode
```

New sessions load it. To try it in one session only:
`claude --plugin-dir /path/to/lightcode-plugins/adapters/claude-code`.
Check savings with `lc report --host claude`.

Turn it off with `claude plugin disable lightcode@lightcode`, or for one run
with `LIGHTCODE_DISABLE=1`. Set `{"economy": {"mode": "observe"}}` in
`~/.lightcode/config.json` to record what would change without changing
anything.
