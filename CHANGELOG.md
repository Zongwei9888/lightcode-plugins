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
- `@lightcode/pi`: pi extension using `context_edit`, so pi's session keeps
  the original output.
- `adapters/codex`: Codex plugin whose `PreToolUse` hook wraps recognizable
  shell commands in `lc run`.
