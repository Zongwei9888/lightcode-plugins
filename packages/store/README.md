# @lightcode-ai/store

Everything LightCode keeps on disk under `~/.lightcode` (or `$LIGHTCODE_HOME`): the journal, the saved originals with their source maps (user-only permissions, removed after the retention period), adopted learned rules with their history, and configuration loading, where a project file can only lower what the user's own file allows.

This is a library for people who build their own LightCode adapter. To use
LightCode, install a plugin instead: `@lightcode-ai/pi` for pi,
`@lightcode-ai/dsh` for DeepSeek Harness, or `@lightcode-ai/cli` for the `lc`
command (Codex and any other agent). The plugins are self-contained and do not
depend on this package.

MIT licensed.
