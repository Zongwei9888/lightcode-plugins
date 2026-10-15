# @lightcode-ai/mechanisms

The mechanisms LightCode adapters wire into a host: the Token Economy engine, LightShadow (recoverable compaction and the `lightcode_recall` tool), self-evolution (evidence, the learner workspace, replay and verification, adoption and the in-use monitor) and the receipts `/lightcode` and `lc report` show. Hosts reach them through small ports, so an adapter only translates host events.

This is a library for people who build their own LightCode adapter. To use
LightCode, install a plugin instead: `@lightcode-ai/pi` for pi,
`@lightcode-ai/dsh` for DeepSeek Harness, or `@lightcode-ai/cli` for the `lc`
command (Codex and any other agent). The plugins are self-contained and do not
depend on this package.

MIT licensed.
