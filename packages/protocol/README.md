# @tokenwise/protocol

What a host offers (`HOST_PROFILES`), what each mechanism needs, and `negotiate`, which picks `apply`, `observe` or `off` for each mechanism and records why. Also the schemas of the journal records every TokenWise implementation writes.

This is a library for people who build their own TokenWise adapter. To use
TokenWise, install a plugin instead: `@tokenwise/pi` for pi,
`@tokenwise/dsh` for DeepSeek Harness, or `@tokenwise/cli` for the `tokenwise`
command (Codex and any other agent). The plugins are self-contained and do not
depend on this package.

MIT licensed.
