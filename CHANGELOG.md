# Changelog

## 0.1.0 (unreleased)

First open-source release line: Token Economy on several hosts.

- `@lightcode/core`: the deterministic output filters of the LightCode
  research runtime — 79 shell-output filters (16 hand-written, 63 from pinned
  RTK built-ins) plus 2 host-native search formats — source maps, the strict-shrink admission rule and command normalization,
  with no host dependency. A conformance corpus pins them byte-for-byte to
  the research runtime (`static-v10`).
- `@lightcode/protocol`: host capability vocabulary, verified host profiles
  and mode negotiation (`off` / `observe` / `apply`).
- `@lightcode/store`: private journal, content-addressed original store with
  retention, and configuration.
- `@lightcode/mechanisms`: the Economy engine (save original → journal →
  deliver projection; fail-open) and session receipts.
- `@lightcode/cli`: `lc run`, `lc hook codex`, `lc report`, `lc doctor`,
  `lc filters`, `lc show`, `lc gc`.
- `@lightcode/pi`: pi package (`pi install npm:@lightcode/pi`) using
  `context_edit`, so pi's session keeps the original output; status bar,
  `/lightcode`, `--lightcode` flag. Tested on pi 1.1.0 and 1.2.0.
- `@lightcode/dsh`: DeepSeek Harness 0.2.x bundle, installable from the
  Plugins page or `dsh plugin add`; filters the `bash` tool in
  `tools/post-execute` before DSH's spill policy; live Mode setting on its
  Plugins page; `/lightcode`; display metadata and icon. Tested on
  0.2.0-rc.2 and 0.2.1-alpha.2, macOS and Linux.
- `adapters/codex`: Codex plugin whose `PreToolUse` hook wraps recognizable
  shell commands in `lc run`; the repository doubles as a Codex marketplace.
- The published packages are self-contained bundles with their licenses and
  notices; `e2e/` installs them into published host releases and runs real
  sessions, the DSH Web UI and pi's TUI (CI on Ubuntu and macOS).
