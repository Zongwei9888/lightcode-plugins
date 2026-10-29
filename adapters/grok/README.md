# LightCode for Grok Build

A Grok plugin with one `PostToolUse` hook on `run_terminal_command`, running
`lc hook grok`. When a LightCode filter recognizes a shell result (test
runners, compilers, `git status/diff`, `grep`/`rg`, `find`, `ls`, build
tools, …) the hook replaces the model's copy of it with LightCode's
projection, keeping Grok's `exit: N` first line. The command runs exactly as
the model wrote it, and permissions are untouched.

Verified against Grok Build 1.0.70, in `grok -p` and in `grok agent stdio`
(the ACP route AutoSwarm uses):

- A failing `pytest -v` run (150 passed, 1 failed): the model read 1,349
  bytes instead of 13,432, and still named the failing test and its
  assertion. Grok fires `PostToolUse` for failed commands too.
- Only the model's copy changes: Grok's scrollback and `updates.jsonl` keep
  the original, and LightCode saves it under `~/.lightcode` as well.
- Results Grok already cut, results over 128 KiB (which Grok hands to hooks
  as text) and any layout other than `exit: N\n<output>` pass through.
- Grok holds back hooks in folders you have not trusted. `grok -p` counts
  its folder as trusted for your own hooks, and plugins loaded with
  `--plugin-dir` are trusted; in the TUI, trust a project with `/hooks-trust`.
- Grok also imports Claude Code hooks. LightCode's Claude Code hook leaves
  Grok's events alone, so nothing is filtered twice.
- `lc` must be on the `PATH` Grok runs hooks with
  (`npm install -g @lightcode-ai/cli`, then `lc doctor`).

## LightShadow (assisted)

Grok lets no plugin change the summary or add context at the moment of
compaction, so (verified on 1.0.70):

- **PostCompact** reads the compacted span from the session's
  `updates.jsonl` (every tool call and result, and a marker per compaction;
  automatic compaction in segments mode writes nothing else), saves its tool
  results and keeps the catalog pending;
- the next **PostToolUse**, of any tool, adds the catalog as
  `additionalContext`; if the turn ends with no tool call, **Stop** does (one
  more model round);
- the plugin's MCP server (`.mcp.json`) offers `lightcode__lightcode_recall`,
  which Grok shows the model through `search_tool` / `use_tool`. Outside
  always-approve mode, allow it once or add a `MCPTool(lightcode__*)` allow
  rule.

## Install

From a checkout of this repository (it doubles as a Grok marketplace):

```sh
grok plugin marketplace add /path/to/lightcode-plugins
grok plugin install lightcode --trust
```

For one ACP process only: `grok agent --plugin-dir /path/to/lightcode-plugins/adapters/grok stdio`.
Check savings with `lc report --host grok`. Turn it off with
`grok plugin disable lightcode`, or for one run with `LIGHTCODE_DISABLE=1`.
