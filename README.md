<div align="center">

<img src="docs/assets/logo.svg" alt="LightCode logo" width="84">

# LightCode

### Fewer tokens on tool output, nothing lost.

Plugins for [pi](https://github.com/earendil-works/pi), DeepSeek Harness and [Codex](https://github.com/openai/codex) that shrink what the model reads,<br>make compaction recoverable, and learn filters for your own tools.

<p>
  <img alt="Version" src="https://img.shields.io/badge/version-0.3.0_(unreleased)-0F766E?style=flat-square">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
  <img alt="Node.js 22+" src="https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=node.js&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="Runtime dependencies: 0" src="https://img.shields.io/badge/runtime_deps-0-0F766E?style=flat-square">
</p>
<p>
  <img alt="pi 1.1+" src="https://img.shields.io/badge/pi-1.1%2B-111827?style=flat-square">
  <img alt="DeepSeek Harness 0.2" src="https://img.shields.io/badge/DeepSeek_Harness-0.2_Web_%C2%B7_Desktop_%C2%B7_CLI-4D6BFE?style=flat-square">
  <img alt="Codex 0.162+" src="https://img.shields.io/badge/Codex-0.162%2B-111827?style=flat-square">
  <img alt="Any shell" src="https://img.shields.io/badge/any_agent-lc_run-475569?style=flat-square">
</p>

<p>
  <a href="README.md"><img alt="English" height="28" src="https://img.shields.io/badge/English-BCDCF7?style=flat-square"></a>&nbsp;
  <a href="docs/zh/README.md"><img alt="简体中文" height="28" src="https://img.shields.io/badge/简体中文-CDCFD4?style=flat-square"></a>
</p>

[Why](#-why-lightcode) · [Quick start](#-quick-start) · [In your agent](#%EF%B8%8F-in-your-agent) · [How it works](#-how-it-works) · [Hosts](#-hosts) · [Commands](#%EF%B8%8F-commands) · [Testing](#-how-it-is-tested) · [Development](#%EF%B8%8F-development)

</div>

---

> **Status: 0.2 in development.** Token Economy, LightShadow and self-evolving
> filters ship as installable plugins for pi and DeepSeek Harness, all on by
> default. Codex, Claude Code, CodeBuddy, Grok, OpenCode and Hermes get Token
> Economy through a plugin, any other agent through `lc run`. Delegation accounting follows in 0.3. Nothing is published to npm
> yet; until then, [install from a checkout](#install-from-a-checkout).

## 📰 News

- **2026-10-15** LightShadow is tested on real ~1M-token DeepSeek sessions with each host's default compaction; DeepSeek Harness tells you when new output is worth learning from.
- **2026-10-14** 🧬 Self-evolving filters: learn from pi's `/lightcode` panel, DeepSeek Harness's Plugins page, or `lc evolve`.
- **2026-10-14** 🌗 LightShadow: recoverable compaction on pi and DeepSeek Harness.
- **2026-10-13** 🧩 Installable plugins for pi and DeepSeek Harness (Web, Desktop, CLI), with an end-to-end suite against published host releases.

## ✨ Why LightCode

Coding agents spend most of their context on tool output: test runs, builds,
diffs, searches, file reads. Most of it is noise the model reads once; some of
it is evidence it needs again after the host has compacted it away.
LightCode plugs into the agent you already use, at the seams the host offers
for plugins, and does three things:

- **Token Economy** — shows the model a smaller, deterministic version of
  recognized output, keeping every failure, warning and total, and keeps the
  original on your machine.
- **LightShadow** — when the host compacts a long session, tool output is
  saved and listed instead of lost; the agent reads any of it back with one
  tool call.
- **Self-evolution** — your own agent writes filters for *your* build scripts
  and logs; LightCode adopts one only after verifying it on output the
  learner never saw.

It is not another agent and keeps everything on your machine (only a
learning run you start sends recorded output to your own agent's model). It
fails open: if anything goes wrong, the model gets the original output.

<div align="center">
<img src="docs/assets/architecture.svg" alt="LightCode architecture: hosts, adapters, mechanisms, foundation" width="100%">
</div>

## 🚀 Quick start

| Your agent | Install |
|---|---|
| **pi** | `pi install npm:@lightcode-ai/pi`, then `/lightcode` in a session |
| **DeepSeek Harness** (Web, Desktop) | **Plugins** → **Add plugin** → `@lightcode-ai/dsh` → **Install** → **Enable now** |
| **DeepSeek Harness** (terminal) | `dsh plugin --profile web add @lightcode-ai/dsh` (needs pnpm 11+) |
| **Codex** | `codex plugin marketplace add <checkout>` → `codex plugin add lightcode@lightcode`, then trust the hooks in `/hooks` |
| **Claude Code** | `claude plugin marketplace add <checkout>` → `claude plugin install lightcode@lightcode` |
| **CodeBuddy** | `codebuddy plugin marketplace add <checkout>` → `codebuddy plugin install lightcode@lightcode` |
| **Grok Build** | `grok plugin marketplace add <checkout>` → `grok plugin install lightcode --trust` |
| **OpenCode** | copy `adapters/opencode/dist/index.js` to `~/.config/opencode/plugins/lightcode.js` |
| **Hermes Agent** | copy `adapters/hermes/lightcode` to `~/.hermes/plugins/`, then `hermes plugins enable lightcode` |
| **Anything else** | `npm install -g @lightcode-ai/cli`, then `lc run -c 'cargo test'` |

Nothing to configure: Economy and LightShadow are on from the next tool call.
`lc report` shows what was saved, `lc doctor` what each host supports.

### Install from a checkout

Until the packages are on npm, build them from this repository (Node.js 22
and pnpm) and install by path:

```sh
git clone https://github.com/Zongwei9888/lightcode-plugins.git lightcode
cd lightcode && pnpm install && pnpm build

pi install "$PWD/adapters/pi"                            # pi
dsh plugin --profile web add "$PWD/adapters/dsh"         # DeepSeek Harness (use your profile)
npm install -g ./packages/cli                            # the lc command
```

In the DeepSeek Harness Desktop app, quit it and use its bundled `dsh` with
`--profile desktop`. Codex, Claude Code, CodeBuddy and Grok install from the
checkout as a marketplace (see [`adapters/codex`](adapters/codex/README.md),
[`adapters/claude-code`](adapters/claude-code/README.md),
[`adapters/codebuddy`](adapters/codebuddy/README.md) and
[`adapters/grok`](adapters/grok/README.md)); they need `lc` on `PATH`.

## 🖥️ In your agent

**pi** — `/lightcode` opens a panel with the session's savings, LightShadow,
the learned rules and the commands worth learning from. Press `l` to learn;
the panel follows the run, and `r` rolls an adoption back.

<div align="center">
<img src="docs/assets/screenshots/pi-panel-adopted.png" alt="pi /lightcode panel after a rule was adopted" width="820">
</div>

**DeepSeek Harness** (Web and Desktop) — install from the **Plugins** page
like any other plugin; the plugin's page has a *Self-evolution* section:
**Learn now**, live progress, the learned rules with a switch and **Roll back**,
and a toast when a run ends.

<div align="center">
<img src="docs/assets/screenshots/dsh-self-evolution.png" alt="DeepSeek Harness LightCode page: self-evolution with a learned rule adopted" width="900">
</div>

<details>
<summary>More screenshots: installing, a run in progress, pi before learning, dark theme</summary>

<p align="center">
<img src="docs/assets/screenshots/dsh-install.png" alt="DeepSeek Harness Plugins page: @lightcode-ai/dsh installed" width="900">
<img src="docs/assets/screenshots/dsh-learning.png" alt="A learning run in progress on the DeepSeek Harness plugin page" width="900">
<img src="docs/assets/screenshots/pi-panel-ready.png" alt="pi /lightcode panel, ready to learn" width="820">
<img src="docs/assets/screenshots/dsh-self-evolution-dark.png" alt="The LightCode plugin page in dark theme" width="900">
</p>

</details>

Screenshots come from the end-to-end suite (`pnpm e2e`), which drives the real
DeepSeek Harness Desktop app and pi's terminal UI with a scripted model.

## 🔍 How it works

### Token Economy

<div align="center">
<img src="docs/assets/economy.svg" alt="pytest -v: 266 lines reduced to 23, with the failure kept in full" width="100%">
</div>

When an agent runs `pytest`, `cargo test`, `git diff`, `grep -rn`, `tsc`,
`find`, a package install or one of ~80 other recognized commands (also as
agents tend to write them: after `cd <dir> &&`, with `2>&1` or `| tee <file>`,
or by path, as in `.venv/bin/pytest`), LightCode
replaces the output the model would read with a deterministic **projection**:
passing-test rows are counted instead of listed, progress bars and repeated
rows are folded, oversized search results and diff hunks are previewed with
explicit omission counts. Results of the hosts' own search tools (pi's `grep`
and `find`, DeepSeek Harness's `grep` and `glob`) are laid out losslessly:
a file's matches and a directory's paths are grouped under it, and every
match, line number and path stays.

The rules it never bends:

- **Strictly smaller or nothing.** A projection is used only if it is
  smaller in UTF-8 bytes *and* saves tokens; otherwise the original passes.
- **Evidence stays.** Failure bodies, diagnostics, warnings, unknown lines,
  totals and exit status are kept; filters that cannot recognize the whole
  output pass it through unchanged. Failed commands are never summarized as
  "ok".
- **Deterministic and first-seen-final.** The same output always gives the
  same bytes, and a result is never re-rendered later, so prompt caches stay
  valid.
- **The original is kept, and the model is told where.** pi keeps it in its
  own session file; with every host LightCode also saves it privately
  (`~/.lightcode`, user-only permissions, 14-day retention) with a source map
  from projection to original. A shortened output ends with one line naming
  its original's ID, which the `lightcode_recall` tool (or `lc recall`)
  reads, so nothing a projection left out is out of reach, before or after
  any compaction. Lossless layouts get no such line.
- **Fail-open.** Any LightCode error delivers the original output.


### LightShadow

<div align="center">
<img src="docs/assets/lightshadow.svg" alt="LightShadow: a long session, the checkpoint with its catalog, and a recall by line" width="100%">
</div>

Long sessions get compacted: the host asks the model to summarize older
history and drops it. Whatever the summary leaves out is gone, including
tool output the agent may need again. With LightShadow, when the host
compacts:

- the host's own summarizer reads the span as usual and is asked to keep the
  findings the agent needs to carry on (paths, line numbers, values,
  errors), not whole files or logs;
- every tool result in the span is saved and replaced by a reference naming
  the call that produced it (the command or path) and a short excerpt (the
  first and last lines, at most 320 bytes);
- the checkpoint that replaces the span is that summary, **your messages
  word for word**, and a catalog of the references: every one of a long
  session, by its call, within a budget of 8% of the span (the newest 40
  with their excerpts);
- the model can read any of them again with the `lightcode_recall` tool:
  exactly what it read before, or a window of up to 8 KB around a string or
  a line number it asks for (numbered lines, the asked one marked), or the
  complete original when Token Economy had shortened it;
- on DeepSeek Harness, a long result its pruner cuts to a head and tail keeps
  its complete text too, and the cut names the observation to recall.

A checkpoint that would not be smaller, or any failure, leaves the
compaction to the host, unchanged.

How much of this a host gets depends on what its plugin interface allows
(`lc doctor` shows it):

| Tier | Hosts | What happens |
|---|---|---|
| **Full** | pi, DeepSeek Harness, OpenCode, Hermes Agent, CodeBuddy | the checkpoint above replaces the host's summary |
| **Assisted** | Claude Code, Codex, Grok Build | the host keeps writing its own summary (no plugin may replace it); LightShadow saves the span's tool results and puts the catalog into the context right after the compaction, and the recall tool comes from the plugin's MCP server (`lc mcp`) |

Any other agent that speaks MCP can read what LightShadow kept with
`lc mcp`; see [docs/adapters.md](docs/adapters.md) for connecting a new one.

### Self-evolving filters

<div align="center">
<img src="docs/assets/evolution.svg" alt="A learning run: record, propose, verify, adopt, watch" width="100%">
</div>

Built-in filters cover common tools; your projects have their own: build
scripts, test runners, linters, deploy logs. LightCode keeps the shell
output it sees as evidence and learns new rules from it, in the background,
when you ask:

- **pi:** `/lightcode` opens a panel with the session's savings, the learned
  rules and how much each saved, the commands worth learning from, and a run
  in progress. Press `l` to learn (pi itself is the learner, on the session's
  model); the footer shows the run, and pi tells you when it ends.
- **DeepSeek Harness (Web and Desktop):** Plugins → LightCode has a
  *Self-evolution* section with the same: **Learn now** (DSH headless is the
  learner, on your default model), live progress, the learned rules with a
  switch and **Roll back**; a toast when there is new output worth learning
  from, and when a run ends.
- **Anywhere:** `lc evolve --learner pi` (or `dsh`, `claude`, `codex`, any command).

A run never blocks a session: it is a separate process, one at a time across
hosts, stopped after 20 minutes (or when you cancel), and running sessions
use adopted rules from their next output on. Each run:

1. **Evidence.** The outputs from your recent sessions that still have
   tokens to save (most frequent first, a few per command) are written to a
   workspace; the rest are held back for verification.
2. **Propose.** Your own coding agent runs there as the learner: it reads
   the evidence and writes or improves rules (small JavaScript functions,
   see `RULES.md` in the workspace), and can run `./check` and `./try`
   while it works.
3. **Verify.** LightCode replays *every* recorded observation with the
   current rules and with the proposal, and checks a set of preservation
   requirements (literal data that looks like layout, application output
   that looks like test progress, failure evidence). The proposal is adopted
   only if it meets every requirement, no rule fails, it saves more tokens in
   total with **no observation saving less**, and the commands it improved
   also save more on observations **the learner never saw** (a rule that only
   fits its examples is rejected).
4. **Watch.** In use, a learned rule whose output the agent keeps needing the
   original of (it asks `lightcode_recall` for the original 3 times, and in at
   least 1 of 5 uses) is switched off automatically, as an adoption you can
   roll back; the next run is told about it.

Adopted rules run before the built-in filters in new sessions on every host,
in a worker thread with its own memory limit and a fresh JavaScript context
for every output (no file system, network, `require`, timers or `eval`;
100 ms per call; a rule that keeps failing is switched off). A rule result is
discarded unless every piece of it is copied from the output (its only own
words are notes like `[120 progress lines omitted]`), it keeps every error,
exception, warning and failure line, and its source map matches.

The learner reads command output from your sessions, which can contain text
written by others (a cloned repository, a web page). Treat it like any agent
working on untrusted input: the Claude Code learner may only run `./check`
and `./try`, Codex runs in its workspace sandbox, and with pi or DeepSeek
Harness the learner has the shell those agents normally have (DSH headless
in its workspace-write sandbox). Whatever it does, only LightCode adopts
rules, after verification; if the active rules change while the learner runs,
nothing is adopted, and `./check` never shows the learner its results on the
held-back observations. Run directories (which copy some recorded output)
are deleted with the originals they came from. The panel, the Plugins page and `lc rules`
list, switch off and roll back adoptions.

## 🧩 Hosts

| Host | Install | How | Economy | LightShadow | Learned rules |
|---|---|---|---|---|---|
| **pi** 1.1+ | `pi install npm:@lightcode-ai/pi` | in-process extension; the projection reaches the model through `context_edit`, so pi's session keeps the original; compaction through `session_before_compact` | apply | apply | yes |
| **DeepSeek Harness** 0.2.x | Plugins → Add plugin → `@lightcode-ai/dsh`, or `dsh plugin --profile web add @lightcode-ai/dsh` | in-process plugin on `tools/post-execute`; compaction through each agent preset's own compaction engine; Mode is editable on its Plugins page | apply | apply | yes |
| **Codex** 0.162+ | `codex plugin marketplace add <checkout>` then `codex plugin add lightcode@lightcode` | plugin `PreToolUse` hook rewrites recognizable commands to `lc run -c '<command>'`; the model's history keeps the original command; `SessionStart(compact)` adds the catalog, the plugin's MCP server the recall tool | apply | assisted | for the commands its hook wraps |
| **Claude Code** 2.1+ | `claude plugin marketplace add <checkout>` then `claude plugin install lightcode@lightcode` | plugin `PostToolUse` hook replaces a successful Bash call's output; in `bypassPermissions` mode `PreToolUse` wraps commands in `lc run` so failed calls are filtered too; `SessionStart(compact)` adds the catalog, the plugin's MCP server the recall tool | apply | assisted | yes |
| **CodeBuddy** 2.175+ | `codebuddy plugin marketplace add <checkout>` then `codebuddy plugin install lightcode@lightcode` | plugin `PreToolUse` hook rewrites recognizable commands to `lc run`, with no permission decision, so CodeBuddy's own checks still apply; the plugin's mod turns the stored summary into the checkpoint | apply | apply | for the commands its hook wraps |
| **Grok Build** 1.0+ | `grok plugin marketplace add <checkout>` then `grok plugin install lightcode --trust` | plugin `PostToolUse` hook replaces the model's copy of a shell result, failed commands included; Grok keeps the original; after a compaction the next tool result carries the catalog, the plugin's MCP server the recall tool | apply | assisted | yes |
| **OpenCode** 1.19+ | copy the bundle to `~/.config/opencode/plugins/` | in-process plugin on `tool.execute.after`; replaces the bash result before OpenCode stores it, failed commands included; compaction through its (experimental) compaction hooks | apply | apply | yes |
| **Hermes Agent** 0.22+ | copy the plugin to `~/.hermes/plugins/`, then `hermes plugins enable lightcode` | Python plugin on `transform_terminal_output` hands the terminal output to `lc hook hermes`, before Hermes limits and redacts it; LightShadow is a context engine (`hermes config set context.engine lightcode`) | apply | apply | yes |
| **Any agent / terminal** | `npm install -g @lightcode-ai/cli` | call `lc run -c '<command>'`; `lc mcp` serves the recall tool to any MCP client | apply | recall only | yes |

Learning starts from `/lightcode` in pi and from the Plugins page in DSH;
`lc evolve` and `lc rules` (from `@lightcode-ai/cli`) do the same in a terminal.

The pi and DeepSeek Harness plugins are tested on macOS and Linux (the DSH
Desktop app on macOS); Windows is not tested yet. Both also filter the output
of subagents (DSH's built-in `subagent` / `subagent_fork`; on pi,
subagent extensions that start `pi` processes), and a session's `/lightcode`
includes what its subagents saved.

`lc doctor` prints what each host supports and why (capability negotiation:
a mechanism runs in `apply`, `observe` or `off` depending on what the host
offers; configuration can only lower that).

#### pi

```sh
pi install npm:@lightcode-ai/pi
```

The status bar shows tokens saved; `/lightcode` shows the session summary
(Economy, LightShadow, learned rules); `pi --lightcode observe` records what
would change without changing anything, for both mechanisms;
`pi config` can switch the extension off. See [`adapters/pi`](adapters/pi/README.md).

#### DeepSeek Harness

In the Web UI or the Desktop app: **Plugins** → **Add plugin** →
`@lightcode-ai/dsh` → **Install** → **Enable now**. Or from a terminal:

```sh
dsh plugin --profile web add @lightcode-ai/dsh     # dsh plugin needs pnpm 11 or later
```

`/lightcode` in a session shows what it saved; **Mode** (Apply / Observe /
Off) on the plugin's page applies to the next tool call and compaction. See
[`adapters/dsh`](adapters/dsh/README.md).

#### Codex

See [`adapters/codex`](adapters/codex/README.md). `lc` must be on `PATH`,
and Codex runs plugin hooks only after you trust them in `/hooks`.

#### Claude Code, CodeBuddy, Grok Build

See [`adapters/claude-code`](adapters/claude-code/README.md),
[`adapters/codebuddy`](adapters/codebuddy/README.md) and
[`adapters/grok`](adapters/grok/README.md). Each plugin runs `lc hook <host>`,
so `lc` must be on `PATH`. Grok and CodeBuddy also run Claude Code hooks;
the Claude Code hook leaves their events alone, so nothing is filtered twice.

#### OpenCode

See [`adapters/opencode`](adapters/opencode/README.md): one file in
`~/.config/opencode/plugins/`, loaded in-process by new sessions.

#### Hermes Agent

See [`adapters/hermes`](adapters/hermes/README.md): a Python plugin that
calls `lc hook hermes`, so `lc` must be installed.

#### Anything else

```sh
lc run -c 'cargo test'           # runs with your shell; prints the filtered output
lc run -- git diff HEAD~3        # runs a program directly
```

Exit codes and signals are passed through. Binary output, output over 32 MiB
per stream and unrecognized output pass through untouched.

## ⌨️ Commands

```
lc report [--host H] [--session S] [--json]   savings, filters used, uncovered commands, LightShadow
lc doctor [--json]                            configuration and per-host negotiation
lc filters [--json]                           every filter and what it preserves
lc show <sha256>                              print a saved original
lc gc [--days N]                              delete saved originals
lc evolve --learner pi|dsh|claude|codex|"<command>" [--since 7d] [--max-cases N] [--timeout 30m] [--dry-run]
                                              learn rules from your evidence; adopt only if verified
lc rules [list|show|path|off|rollback]        learned rules
lc recall <observation_id> [--query Q | --line N] [--original]
                                              read again a tool result LightShadow kept
lc mcp [--host H]                             MCP server (stdio) with the lightcode_recall tool
lc shadow checkpoint|catalog|instruction      LightShadow for host adapters (JSON on stdin; see docs/adapters.md)
```

A custom learner command runs with `sh -c` in the workspace; `{prompt}` is
replaced by the instruction (read `PROMPT.md`), which is also in
`$LIGHTCODE_EVOLVE_PROMPT`. Each run keeps its workspace, the learner's log
and the verdict under `~/.lightcode/evolve/`.

## ⚙️ Configuration

`~/.lightcode/config.json` (or `$LIGHTCODE_HOME/config.json`):

```json
{
  "economy": {
    "mode": "apply",
    "minimumSavedTokens": 16,
    "commandNormalization": true,
    "evidence": true,
    "learnedRules": true,
    "filterOptions": { "grep": { "maxPerFile": 25 }, "git-diff": { "maxHunkLines": 100 } }
  },
  "lightshadow": { "mode": "apply" },
  "artifacts": { "retentionDays": 14 }
}
```

`evidence` keeps the original of every shell output (not only shortened
ones) for `lc evolve`; `learnedRules` lets new sessions use adopted rules.
A project may add `.lightcode/config.json` with `economy` and `lightshadow`
settings only; it can lower a mode or switch command normalization,
evidence or learned rules off, never turn back on what your own file turned
off. `LIGHTCODE_ECONOMY`, `LIGHTCODE_LIGHTSHADOW` (`apply|observe|off`) and
`LIGHTCODE_DISABLE=1` override both. An invalid setting turns Economy and
LightShadow off (and `lc doctor` says why).

## 🔒 Privacy

Everything stays on your machine. Saved originals can contain whatever your
commands printed, including secrets; they are written with user-only
permissions and removed after the retention period. LightCode makes no
network requests. `lc evolve` is the one exception you start yourself: the
learner you choose is your coding agent, so the evidence it reads (recent
command output) goes to that agent's model provider, as the outputs did
when the agent first ran them. Set `economy.evidence` to `false` to keep no
evidence at all.

## ✅ How it is tested

| Layer | What runs |
|---|---|
| Unit tests | 1,020 tests across core, protocol, store, mechanisms, cli and the adapters; pi's run a real pi session with a scripted model; the hook-based hosts' are built from payloads and transcripts captured from each host |
| Conformance | `conformance/economy`: every implementation must reproduce the expected projections byte for byte |
| End to end | `pnpm e2e` installs the packed plugins from a local registry into published pi and DeepSeek Harness releases (two Web versions and the Desktop app) and drives them through their own plugin commands and UI; 51 checks locally, and on Linux and macOS in CI (all but the Desktop app) |
| Real models | long DeepSeek sessions with each host's **default** compaction settings, until the host compacts on its own; the agent then has to quote lines it read before compaction |

From the real DeepSeek runs (LightShadow checkpoint, reference count, recall):

| Host | Compacted span → checkpoint | References | After compaction |
|---|---|---|---|
| pi | ~949k → 29.5k tokens | 624 | 2 recalls by line, every question answered correctly |
| DeepSeek Harness | ~539k → 30.8k tokens | 589 | 2 recalls, every question answered correctly |

Every host was also run on a real model with a lowered compaction threshold
(about 20–35k tokens; DeepSeek V4 Flash on Volcengine Ark unless named): the
agent reads ten 7 KB files, the host compacts, and the agent must quote one
line of the first file without reading it again.

| Host | Tier | Result |
|---|---|---|
| pi 1.1.0 | full | checkpoint with 8 references; answered from one `lightcode_recall` |
| DeepSeek Harness 0.2.1 | full | 2 checkpoints; answered from one recall |
| OpenCode 1.19.4 | full | 3 checkpoints (two automatic compactions in one turn); answered from one recall |
| Hermes Agent 0.22.5 | full | Hermes's compressor with the `lightcode` engine; answered from one recall, out of a single 37 KB JSON-escaped line |
| CodeBuddy 2.175.0 | full | the stored summary became a checkpoint with 10 references after `/compact`; answered from one recall |
| Claude Code 2.1.312 (Haiku) | assisted | catalog added after the automatic compaction; answered from the plugin's MCP recall tool |
| Codex 0.165.0 (GPT) | assisted | 3 automatic compactions, catalog after each; answered from the MCP recall tool |
| Grok Build 1.0.70 (grok-4.7) | assisted | catalog with the first turn after `/compact`; answered from the MCP recall tool |

## 🏗️ Repository

```
packages/core        filters, learned-rule sandbox, source maps, admission, command normalization — no host dependency
packages/protocol    capability vocabulary, host profiles, negotiation, journal schema
packages/store       private journal, original store, adopted rules, configuration
packages/mechanisms  Economy engine, LightShadow, evolution (evidence, replay, verification), receipts
packages/cli         the lc command                      → @lightcode-ai/cli
adapters/pi          pi extension                        → @lightcode-ai/pi
adapters/dsh         DeepSeek Harness plugin             → @lightcode-ai/dsh
adapters/codex       Codex plugin (hooks)
adapters/claude-code Claude Code plugin (hooks)
adapters/codebuddy   CodeBuddy Code plugin (hooks)
adapters/grok        Grok Build plugin (hooks)
adapters/opencode    OpenCode plugin                     → @lightcode-ai/opencode
adapters/hermes      Hermes Agent plugin (Python, calls lc)
conformance/         corpus every implementation must reproduce byte-for-byte
e2e/                 installs the packages into published hosts and runs real sessions
```

The four published packages are single-file bundles (`scripts/bundle.mjs`)
with no runtime dependencies; the host's own modules stay external.

Design: [docs/architecture.md](docs/architecture.md) · Releasing:
[docs/releasing.md](docs/releasing.md) · 中文：[docs/zh/README.md](docs/zh/README.md)

## 🛠️ Development

```sh
pnpm install
pnpm check        # typecheck, build and bundle, all unit tests (pi tests drive a real pi session with a fake model)
pnpm e2e          # install into published pi and DeepSeek Harness releases and run real sessions (see e2e/README.md)
```

Changing a filter's output requires a new `ECONOMY_RUNTIME_VERSION` and a new
expected file in `conformance/economy/`.

## 📄 License

MIT. The RTK built-in filter data in `packages/core/src/rtk/` is Apache-2.0;
see [`third-party/rtk`](third-party/rtk/NOTICE.md).
