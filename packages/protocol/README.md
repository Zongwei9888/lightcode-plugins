# @lightcode-ai/protocol

What a host offers (`HOST_PROFILES`), what each mechanism needs, and `negotiate`, which picks `apply`, `observe` or `off` for each mechanism and records why. Also the schemas of the journal records every LightCode implementation writes.

This is a library for people who build their own LightCode adapter. To use
LightCode, install a plugin instead: `@lightcode-ai/pi` for pi,
`@lightcode-ai/dsh` for DeepSeek Harness, or `@lightcode-ai/cli` for the `lc`
command (Codex and any other agent). The plugins are self-contained and do not
depend on this package.

MIT licensed.
