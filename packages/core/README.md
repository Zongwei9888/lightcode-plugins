# @tokenwise/core

The pure part of TokenWise: the filters that turn tool output into a smaller, deterministic projection, the source map from projection to original, the admission rule (strictly smaller, saves tokens, or the original), command normalization and the sandbox learned rules run in. No I/O and no host dependency; the same input gives the same bytes everywhere.

This is a library for people who build their own TokenWise adapter. To use
TokenWise, install a plugin instead: `@tokenwise/pi` for pi,
`@tokenwise/dsh` for DeepSeek Harness, or `@tokenwise/cli` for the `tokenwise`
command (Codex and any other agent). The plugins are self-contained and do not
depend on this package.

MIT licensed.
