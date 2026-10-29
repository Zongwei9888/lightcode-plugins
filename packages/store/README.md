# @tokenwise/store

Everything TokenWise keeps on disk under `~/.tokenwise` (or `$TOKENWISE_HOME`): the journal, the saved originals with their source maps (user-only permissions, removed after the retention period), adopted learned rules with their history, and configuration loading, where a project file can only lower what the user's own file allows.

This is a library for people who build their own TokenWise adapter. To use
TokenWise, install a plugin instead: `@tokenwise/pi` for pi,
`@tokenwise/dsh` for DeepSeek Harness, or `@tokenwise/cli` for the `tokenwise`
command (Codex and any other agent). The plugins are self-contained and do not
depend on this package.

MIT licensed.
