# LightCode

LightCode makes coding agents spend fewer tokens on tool output without
hiding evidence from them. It plugs into existing agents — [pi](https://github.com/earendil-works/pi),
[Codex](https://github.com/openai/codex) and DeepSeek Harness — instead of
being another agent.

> **Status: 0.1 in development.** This release line ships **Token Economy**
> as installable plugins for pi and DeepSeek Harness, a Codex plugin, and
> `lc run` for any agent. Recoverable compaction (LightShadow) and delegation
> accounting follow in 0.2 and 0.3. Nothing is published to npm yet.

## What Token Economy does

When an agent runs `pytest`, `cargo test`, `git diff`, `grep -rn`, `tsc`,
`find`, a package install or one of ~80 other recognized commands, LightCode
replaces the output the model would read with a deterministic **projection**:
passing-test rows are counted instead of listed, progress bars and repeated
rows are folded, oversized search results and diff hunks are previewed with
explicit omission counts.

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

## Hosts

| Host | Install | How | Economy |
|---|---|---|---|
| **pi** 1.1+ | `pi install npm:@lightcode/pi` | in-process extension; the projection reaches the model through `context_edit`, so pi's session keeps the original | apply |
| **DeepSeek Harness** 0.2.x | Plugins → Add plugin → `@lightcode/dsh`, or `dsh plugin --profile web add @lightcode/dsh` | in-process plugin on `tools/post-execute`; Mode is editable on its Plugins page | apply |
| **Codex** 0.162+ | `codex plugin marketplace add <checkout>` then `codex plugin add lightcode@lightcode` | plugin `PreToolUse` hook rewrites recognizable commands to `lc run -c '<command>'`; the model's history keeps the original command | apply |
| **Any agent / terminal** | `npm install -g @lightcode/cli` | call `lc run -c '<command>'` | apply |

`lc doctor` prints what each host supports and why (capability negotiation:
a mechanism runs in `apply`, `observe` or `off` depending on what the host
offers; configuration can only lower that).

### pi

```sh
pi install npm:@lightcode/pi
```

The status bar shows tokens saved; `/lightcode` shows the session summary;
`pi --lightcode observe` records what would change without changing anything;
`pi config` can switch the extension off. See [`adapters/pi`](adapters/pi/README.md).

### DeepSeek Harness

In the Web UI or the Desktop app: **Plugins** → **Add plugin** →
`@lightcode/dsh` → **Install** → **Enable now**. Or from a terminal:

```sh
dsh plugin --profile web add @lightcode/dsh     # dsh plugin needs pnpm 11 or later
```

`/lightcode` in a session shows what it saved; **Mode** (Apply / Observe /
Off) on the plugin's page applies to the next tool call. See
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
lc report [--host H] [--session S] [--json]   savings, filters used, most frequent uncovered commands
lc doctor [--json]                            configuration and per-host negotiation
lc filters [--json]                           every filter and what it preserves
lc show <sha256>                              print a saved original
lc gc [--days N]                              delete saved originals
```

## Configuration

`~/.lightcode/config.json` (or `$LIGHTCODE_HOME/config.json`):

```json
{
  "economy": {
    "mode": "apply",
    "minimumSavedTokens": 16,
    "commandNormalization": true,
    "filterOptions": { "grep": { "maxPerFile": 25 }, "git-diff": { "maxHunkLines": 100 } }
  },
  "artifacts": { "retentionDays": 14 }
}
```

A project may add `.lightcode/config.json` with `economy` settings only; it
can lower the mode or switch command normalization off, never turn back on
what your own file turned off. `LIGHTCODE_ECONOMY=apply|observe|off` and
`LIGHTCODE_DISABLE=1` override both. An invalid setting turns Economy off (and `lc doctor` says why).

## Privacy

Everything stays on your machine. Saved originals can contain whatever your
commands printed, including secrets; they are written with user-only
permissions and removed after the retention period. LightCode makes no
network requests.

## Repository

```
packages/core        filters, source maps, admission, command normalization — no host dependency
packages/protocol    capability vocabulary, host profiles, negotiation, journal schema
packages/store       private journal, original store, configuration
packages/mechanisms  Economy engine and receipts over the ports
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
