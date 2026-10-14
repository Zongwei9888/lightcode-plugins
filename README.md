# LightCode

LightCode makes coding agents spend fewer tokens on tool output without
hiding evidence from them. It plugs into existing agents — [pi](https://github.com/earendil-works/pi),
[Codex](https://github.com/openai/codex) and DeepSeek Harness — instead of
being another agent.

> **Status: 0.2 in development.** This release line ships three mechanisms,
> all on by default, as installable plugins for pi and DeepSeek Harness:
> **Token Economy** (smaller tool output), **LightShadow** (recoverable
> compaction) and **self-evolving filters** (`lc evolve`). Codex gets Token
> Economy through a plugin, any other agent through `lc run`. Delegation
> accounting follows in 0.3. Nothing is published to npm yet.

## What Token Economy does

When an agent runs `pytest`, `cargo test`, `git diff`, `grep -rn`, `tsc`,
`find`, a package install or one of ~80 other recognized commands, LightCode
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
- **The original is kept.** pi keeps it in its own session file; with every
  host LightCode also saves it privately (`~/.lightcode`, user-only
  permissions, 14-day retention) with a source map from projection to
  original.
- **Fail-open.** Any LightCode error delivers the original output.

## What LightShadow does

Long sessions get compacted: the host asks the model to summarize older
history and drops it. Whatever the summary leaves out is gone, including
tool output the agent may need again. With LightShadow, when pi or DeepSeek
Harness compacts:

- every tool result in the compacted span is saved and replaced by a
  reference with a short excerpt (the first and last lines, at most 320
  bytes); the host's own summarizer then condenses only what is left;
- the checkpoint that replaces the span is that summary, **your messages
  word for word**, and a catalog of the references;
- the model can read any of them again with the `lightcode_recall` tool:
  exactly what it read before, or a window of up to 8 KB around a string it
  asks for, or the complete original when Token Economy had shortened it;
- on DeepSeek Harness, a long result its pruner cuts to a head and tail keeps
  its complete text too, and the cut names the observation to recall.

A checkpoint that would not be smaller, or any failure, leaves the
compaction to the host, unchanged.

## Self-evolving filters

Built-in filters cover common tools; your projects have their own: build
scripts, test runners, linters, deploy logs. LightCode keeps the shell
output it sees as evidence, and `lc evolve` turns it into new rules:

```sh
lc evolve --learner pi          # or dsh, claude, codex, or any command
```

1. **Evidence.** The outputs from your recent sessions that still have
   tokens to save (most frequent first) are written to a workspace, with
   the full set kept apart for verification.
2. **Propose.** Your own coding agent runs there as the learner: it reads
   the evidence and writes or improves rules (small JavaScript functions,
   see `RULES.md` in the workspace), and can run `./check` and `./try`
   while it works.
3. **Verify.** LightCode replays *every* recorded observation with the
   current rules and with the proposal, and checks a set of preservation
   requirements (literal data that looks like layout, application output
   that looks like test progress, failure evidence). The proposal is adopted
   only if it meets every requirement, no rule fails, and it saves more
   tokens in total with **no observation saving less**.

Adopted rules run before the built-in filters in new sessions on every host,
in a sandbox (no file system, network, `require`, timers or `eval`; 100 ms
per call), and a rule result that drops an error, warning or failure line,
or whose source map does not match the output, is discarded. `lc rules`
lists, shows, switches off and rolls back adoptions.

## Hosts

| Host | Install | How | Economy | LightShadow | Learned rules |
|---|---|---|---|---|---|
| **pi** 1.1+ | `pi install npm:@lightcode/pi` | in-process extension; the projection reaches the model through `context_edit`, so pi's session keeps the original; compaction through `session_before_compact` | apply | apply | yes |
| **DeepSeek Harness** 0.2.x | Plugins → Add plugin → `@lightcode/dsh`, or `dsh plugin --profile web add @lightcode/dsh` | in-process plugin on `tools/post-execute`; compaction through each agent preset's own compaction engine; Mode is editable on its Plugins page | apply | apply | yes |
| **Codex** 0.162+ | `codex plugin marketplace add <checkout>` then `codex plugin add lightcode@lightcode` | plugin `PreToolUse` hook rewrites recognizable commands to `lc run -c '<command>'`; the model's history keeps the original command | apply | — (Codex lets plugins shape, not supply, compaction) | for the commands its hook wraps |
| **Any agent / terminal** | `npm install -g @lightcode/cli` | call `lc run -c '<command>'` | apply | — | yes |

`lc evolve` and `lc rules` come with `@lightcode/cli`.

The pi and DeepSeek Harness plugins are tested on macOS and Linux (the DSH
Desktop app on macOS); Windows is not tested yet. Both also filter the output
of subagents (DSH's built-in `subagent` / `subagent_fork`; on pi,
subagent extensions that start `pi` processes), and a session's `/lightcode`
includes what its subagents saved.

`lc doctor` prints what each host supports and why (capability negotiation:
a mechanism runs in `apply`, `observe` or `off` depending on what the host
offers; configuration can only lower that).

### pi

```sh
pi install npm:@lightcode/pi
```

The status bar shows tokens saved; `/lightcode` shows the session summary
(Economy, LightShadow, learned rules); `pi --lightcode observe` records what
would change without changing anything, for both mechanisms;
`pi config` can switch the extension off. See [`adapters/pi`](adapters/pi/README.md).

### DeepSeek Harness

In the Web UI or the Desktop app: **Plugins** → **Add plugin** →
`@lightcode/dsh` → **Install** → **Enable now**. Or from a terminal:

```sh
dsh plugin --profile web add @lightcode/dsh     # dsh plugin needs pnpm 11 or later
```

`/lightcode` in a session shows what it saved; **Mode** (Apply / Observe /
Off) on the plugin's page applies to the next tool call and compaction. See
[`adapters/dsh`](adapters/dsh/README.md).

### Codex

See [`adapters/codex`](adapters/codex/README.md). `lc` must be on `PATH`,
and Codex runs plugin hooks only after you trust them in `/hooks`.

### Anything else

```sh
lc run -c 'cargo test'           # runs with your shell; prints the filtered output
lc run -- git diff HEAD~3        # runs a program directly
```

Exit codes and signals are passed through. Binary output, output over 32 MiB
per stream and unrecognized output pass through untouched.

## Commands

```
lc report [--host H] [--session S] [--json]   savings, filters used, uncovered commands, LightShadow
lc doctor [--json]                            configuration and per-host negotiation
lc filters [--json]                           every filter and what it preserves
lc show <sha256>                              print a saved original
lc gc [--days N]                              delete saved originals
lc evolve --learner pi|dsh|claude|codex|"<command>" [--since 7d] [--max-cases N] [--timeout 30m] [--dry-run]
                                              learn rules from your evidence; adopt only if verified
lc rules [list|show|path|off|rollback]        learned rules
```

A custom learner command runs with `sh -c` in the workspace; `{prompt}` is
replaced by the instruction (read `PROMPT.md`), which is also in
`$LIGHTCODE_EVOLVE_PROMPT`. Each run keeps its workspace, the learner's log
and the verdict under `~/.lightcode/evolve/`.

## Configuration

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

## Privacy

Everything stays on your machine. Saved originals can contain whatever your
commands printed, including secrets; they are written with user-only
permissions and removed after the retention period. LightCode makes no
network requests. `lc evolve` is the one exception you start yourself: the
learner you choose is your coding agent, so the evidence it reads (recent
command output) goes to that agent's model provider, as the outputs did
when the agent first ran them. Set `economy.evidence` to `false` to keep no
evidence at all.

## Repository

```
packages/core        filters, learned-rule sandbox, source maps, admission, command normalization — no host dependency
packages/protocol    capability vocabulary, host profiles, negotiation, journal schema
packages/store       private journal, original store, adopted rules, configuration
packages/mechanisms  Economy engine, LightShadow, evolution (evidence, replay, verification), receipts
packages/cli         the lc command                      → @lightcode/cli
adapters/pi          pi extension                        → @lightcode/pi
adapters/dsh         DeepSeek Harness plugin             → @lightcode/dsh
adapters/codex       Codex plugin (hooks)
conformance/         corpus every implementation must reproduce byte-for-byte
e2e/                 installs the packages into published hosts and runs real sessions
```

The three published packages are single-file bundles (`scripts/bundle.mjs`)
with no runtime dependencies; the host's own modules stay external.

Design: [docs/architecture.md](docs/architecture.md) · Releasing:
[docs/releasing.md](docs/releasing.md) · 中文：[docs/zh/README.md](docs/zh/README.md)

## Development

```sh
pnpm install
pnpm check        # typecheck, build and bundle, all unit tests (pi tests drive a real pi session with a fake model)
pnpm e2e          # install into published pi and DeepSeek Harness releases and run real sessions (see e2e/README.md)
```

Changing a filter's output requires a new `ECONOMY_RUNTIME_VERSION` and a new
expected file in `conformance/economy/`.

## License

MIT. The RTK built-in filter data in `packages/core/src/rtk/` is Apache-2.0;
see [`third-party/rtk`](third-party/rtk/NOTICE.md).
