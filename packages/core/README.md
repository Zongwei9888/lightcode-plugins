# @lightcode-ai/core

The pure part of LightCode: the filters that turn tool output into a smaller, deterministic projection, the source map from projection to original, the admission rule (strictly smaller, saves tokens, or the original), command normalization and the sandbox learned rules run in. No I/O and no host dependency; the same input gives the same bytes everywhere.

This is a library for people who build their own LightCode adapter. To use
LightCode, install a plugin instead: `@lightcode-ai/pi` for pi,
`@lightcode-ai/dsh` for DeepSeek Harness, or `@lightcode-ai/cli` for the `lc`
command (Codex and any other agent). The plugins are self-contained and do not
depend on this package.

MIT licensed. The RTK filter data in `src/rtk/` is Apache-2.0 (`LICENSE.rtk`, `NOTICE.md`).
