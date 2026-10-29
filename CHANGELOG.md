# Changelog

## 0.3.0 (unreleased)

First open-source release line: Token Economy on eight hosts and any shell,
recoverable compaction (LightShadow) on every host whose plugin interface
allows it (in full on five, assisted on three), and self-evolving filters. (0.1.0 and 0.2.0 were never published; their contents are part of this release.)

- LightShadow: when pi or DeepSeek Harness compacts, tool results in the
  compacted span are saved and replaced by references with a 320-byte
  excerpt; the host's own summarizer reads the span in full and keeps the
  findings; the checkpoint keeps
  the user's messages verbatim and lists the references; `lightcode_recall`
  reads any of them again (exactly, or a window of up to 8 KB around a
  string or around a line, numbered, or the complete original Economy
  shortened). A checkpoint that is
  not smaller, or any failure, leaves the compaction to the host. On pi
  through `session_before_compact` (references also stored in the compaction
  entry); on DeepSeek Harness by wrapping `summarize` of each preset's
  compaction engine, and the tool-result pruner keeps the complete text of
  results it cuts. `lightshadow.mode`, `LIGHTCODE_LIGHTSHADOW`; `/lightcode`,
  `lc report` and `lc doctor` report it. Each reference names the call that
  produced it (command or path), and the catalog lists every reference of a
  long session within 8% of the span's tokens (only the newest 40 in full,
  older ones by their call), instead of the newest 200. A result DeepSeek
  Harness's pruner had cut is referenced by its complete text. On pi, a
  summary that fails (it ran past pi's output budget once in a real ~1M-token
  span) is redone with pi's own instructions and the references are kept; a
  checkpoint that falls back records the error in the journal.
  A compaction right after another, whose span is mostly the previous
  checkpoint, lists the carried references by their call alone when the full
  catalog leaves no room for a summary, instead of falling back to the host's
  summary, which dropped every observation_id.
- LightShadow on every host whose plugin interface allows it, in two tiers
  (`lc doctor` shows which). **Full** (the checkpoint replaces the host's
  summary): OpenCode through its experimental compaction hooks
  (`session.compacting`, `chat.messages.transform`, `text.complete`, plus a
  `lightcode_recall` plugin tool); Hermes as a context engine
  (`context.engine: lightcode`) that is Hermes's own compressor with the
  checkpoint, recall as an engine tool, and results Hermes shortened outside
  the summary marked with their ID; CodeBuddy through a mod in the plugin
  (`session.append` rewrites the stored summary, recall is a mod tool).
  **Assisted** (the host keeps writing its summary; a new `compactionContext`
  capability): Claude Code (`SessionStart(compact)` adds the catalog under its
  10,000-character limit, read from the transcript, the subagent's when a
  subagent compacted; PreCompact adds a line to the summarizer's
  instructions), Codex (`SessionStart(compact)` with a raised
  `additionalContextLimit`; the catalog shows the code-mode call) and Grok
  (PostCompact reads the span from the session's `updates.jsonl`, which also
  covers automatic compaction in segments mode, where Grok writes no
  `compaction_requests/`; the next tool result, or Stop, carries the
  catalog). Their recall tool is the plugin's MCP server. Each
  assisted catalog lists every reference of the session, since hosts drop
  the previous one. Verified on each host with a real model.
- `lc mcp`: a dependency-free MCP server (stdio) with `lightcode_recall`
  (read-only annotations, so Codex runs it without asking); `lc recall`;
  `lc shadow checkpoint|catalog|instruction|tool` (JSON on stdin) for
  adapters that are not JavaScript or run outside the host. The service
  behind them (`shadowCheckpoint`, `shadowCatalog`, `recallFromJournal`) is in
  `@lightcode-ai/mechanisms`; `docs/adapters.md` explains how to connect a
  new agent.
- A command ending in `2>&1` or `| tee <file>` (agents add them to most
  test runs, as in `cd /repo && python3 -m pytest -v 2>&1 | tee run.txt`) is
  recognized like the command without them; before, its output passed
  through unfiltered. Found in real
  agent sessions, where it hid the largest outputs (a 31 KB pytest run).
- A shortened output ends with one line naming its original's ID
  (`[LightCode shortened this output. The complete output is observation
  o-…: read it with lightcode_recall …, or run lc recall o-….]`), placed
  before the host's own footer, and only when the projection still saves
  enough with it; lossless layouts get none. The recall tool and `lc recall`
  read these originals by that ID before any compaction (pi shows its recall
  tool when the first one appears). A learned rule's original read this way
  counts toward switching the rule off.
- A program given by its path (`.venv/bin/pytest`,
  `/opt/homebrew/bin/python3 -m pytest`, `/usr/bin/git diff`) is recognized
  by the built-in filters like the bare name; learned rules still see the
  command as written. (Commands the RTK filter catalog covers still match by
  bare name only.)
- Recall on a line longer than its 8 KB window (minified JSON, a
  JSON-escaped log) returns the part around the match, not the line's start.
- Claude Code, CodeBuddy Code and Grok Build plugins (`adapters/claude-code`,
  `adapters/codebuddy`, `adapters/grok`; the checkout is a marketplace for
  each), all running `lc hook <host>`. Claude Code: `PostToolUse` replaces a
  successful Bash call's output, and in `bypassPermissions` mode `PreToolUse`
  wraps commands in `lc run`, so failed calls are filtered too; it never
  returns a permission decision. CodeBuddy: `PreToolUse` wraps commands in
  `lc run` with no permission decision (CodeBuddy checks the command as
  written, so allow and deny rules keep working; its `PostToolUse` carries no
  output). Grok: `PostToolUse` replaces the model's copy of a shell result,
  failed commands included. The Claude Code hook leaves Grok's and
  CodeBuddy's events to their own plugin. Journal records of result-replacing
  hooks have `delivery: "result-hook"`.
- OpenCode plugin (`@lightcode-ai/opencode`, one file for
  `~/.config/opencode/plugins/`): `tool.execute.after` replaces a recognized
  bash result before OpenCode stores it, failed commands included; output
  OpenCode already cut, and timeouts, pass through.
- Hermes Agent plugin (`adapters/hermes/lightcode`, Python): hands
  `transform_terminal_output` to `lc hook hermes`, before Hermes limits,
  strips and redacts the output; output Hermes cut, stopped commands and
  background output pass through; `pre_tool_call` (observed, no directive)
  supplies the session ID. Fail-open when `lc` is missing or slow.
- Self-evolving filters: the engine keeps the original of every complete
  shell output as evidence (`economy.evidence`), with its stream layout.
  `lc evolve --learner pi|dsh|claude|codex|<command>` writes a workspace
  with the most promising evidence, runs the learner, replays every recorded
  observation with the current and the proposed rules plus a set of
  preservation requirements, and adopts the proposal only if every
  requirement holds, no rule fails, and the total saving grows with no
  observation saving less. Learned rules run before the built-in filters, in
  a sandboxed V8 context, and a result that drops a diagnostic line or has an
  invalid source map is discarded. `lc rules` lists, shows, switches off and
  rolls back adoptions; `economy.learnedRules` switches them off.
- Learning from the hosts' own interfaces. pi: `/lightcode` opens a panel
  (savings, learned rules and their use, commands worth learning from, a run
  in progress; `l` learn, `c` cancel, `r` roll back, `o` off/on), the status
  bar follows a run, and pi announces its result; the learner is pi on the
  session's model. DeepSeek Harness: a *Self-evolution* section on the
  plugin's Plugins page (Web and Desktop) with **Learn now**, live progress,
  the learned rules with a switch and **Roll back**, a toast when a run
  ends, and one when recorded output becomes worth learning from (the scan
  runs again two minutes after new output, otherwise every ten; commands
  newly worth learning from are named first); the learner is DSH headless on the default model and the profile's
  providers. Both run learning as a separate process (one at a time across
  hosts, 20 minutes at most, cancellable); running sessions use adopted rules
  from their next output on. `/lightcode learn | cancel | rules | rollback |
  off | on` on both hosts.
- Verification holds observations back: the learner sees at most 70% of each
  command's observations, and a proposal whose improved commands save
  nothing more on the held-back ones is rejected (`did-not-generalize`).
- In-use monitor: a learned rule whose original the agent asks
  `lightcode_recall` for 3 times and in at least 1 of 5 uses is switched off
  (an adoption that can be rolled back), and the next learner is told.
- Switching learned rules back on restores the ones in use when they were
  switched off.

- `@lightcode-ai/core`: the deterministic output filters of the LightCode
  research runtime — 79 shell-output filters (16 hand-written, 63 from pinned
  RTK built-ins) plus 2 host-native search formats — source maps, the strict-shrink admission rule and command normalization,
  with no host dependency. A conformance corpus pins them byte-for-byte to
  the research runtime (`static-v10`).
- `@lightcode-ai/protocol`: host capability vocabulary, verified host profiles
  and mode negotiation (`off` / `observe` / `apply`).
- `@lightcode-ai/store`: private journal, content-addressed original store with
  retention, and configuration (a project's file can only lower the mode).
- `@lightcode-ai/mechanisms`: the Economy engine (save original → journal →
  deliver projection; fail-open) and session receipts.
- `@lightcode-ai/cli`: `lc run`, `lc hook codex|claude|codebuddy|grok|hermes`, `lc report`, `lc doctor`,
  `lc filters`, `lc show`, `lc gc`.
  `lc <command> --help` prints the usage, and an unknown option prints one
  line (exit 2) instead of a stack trace.
- `@lightcode-ai/pi`: pi package (`pi install npm:@lightcode-ai/pi`) using
  `context_edit`, so pi's session keeps the original output; status bar,
  `/lightcode`, `--lightcode` flag. Tested on pi 1.1.0 and 1.2.0.
- `@lightcode-ai/dsh`: DeepSeek Harness 0.2.x bundle, installable from the
  Plugins page or `dsh plugin add`; filters the `bash` tool in
  `tools/post-execute` before DSH's spill policy; live Mode setting on its
  Plugins page; `/lightcode`; display metadata and icon. Tested on
  0.2.0-rc.2 and 0.2.1-alpha.2 (CLI and Web UI on macOS and Linux, the
  Desktop app on macOS: the signed 0.2.0-rc.2 release and a 0.2.1-alpha.2
  build).
- Native search tools: results of pi's `grep` / `find` and DeepSeek
  Harness's `grep` / `glob` are laid out losslessly (`native-grep`,
  `native-glob`): rows grouped by file, paths by directory, every match,
  line number, path and notice kept. They go through the same admission,
  original store and journal as shell output.
- Subagents: both plugins filter the `bash` output of subagents (DSH's
  in-process `subagent` / `subagent_fork`; pi subagent extensions that start
  `pi` processes). A `session/subagent` journal record links each subagent
  session to its parent, so `/lightcode`, pi's status bar and
  `lc report --session` include what subagents saved. On pi the parent's
  session ID is handed to direct child processes only, so `/new`, `/resume`
  and `/fork` never count as subagents.
- `adapters/codex`: Codex plugin whose `PreToolUse` hook wraps recognizable
  shell commands in `lc run`; the repository doubles as a Codex marketplace.
- The published packages are self-contained bundles with their licenses and
  notices; `e2e/` installs them into published host releases and runs real
  sessions, the DSH Web UI and Desktop app, and pi's TUI (CI on Ubuntu and
  macOS).
