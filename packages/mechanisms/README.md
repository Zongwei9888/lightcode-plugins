# @tokenwise/mechanisms

The mechanisms TokenWise adapters wire into a host: the compact-output engine, recoverable compaction (with the `tokenwise_recall` tool), self-evolution (evidence, the learner workspace, replay and verification, adoption and the in-use monitor) and the receipts `/tokenwise` and `tokenwise report` show. Hosts reach them through small ports, so an adapter only translates host events.

This is a library for people who build their own TokenWise adapter. To use
TokenWise, install a plugin instead: `@tokenwise/pi` for pi,
`@tokenwise/dsh` for DeepSeek Harness, or `@tokenwise/cli` for the `tokenwise`
command (Codex and any other agent). The plugins are self-contained and do not
depend on this package.

MIT licensed.
