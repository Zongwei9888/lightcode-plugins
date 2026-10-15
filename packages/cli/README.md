# lc — the LightCode command

```sh
npm install -g @lightcode-ai/cli
lc doctor
```

`lc` runs any command with LightCode's output filtering, serves the Codex
hook, reports what LightCode saved on every host (pi, DeepSeek Harness,
Codex), and learns new filter rules from your own sessions (`lc evolve`).

```
lc run -c '<script>'            run with your shell, print the filtered output (exit code and signals pass through)
lc run -- <program> [args...]   run a program directly
lc hook codex                   Codex PreToolUse hook handler (reads hook JSON on stdin)
lc report [--host H] [--session S] [--json]   savings; a session includes its subagent sessions
lc filters [--json]             every filter and what it preserves
lc show <sha256>                print a saved original
lc gc [--days N]                delete saved originals older than N days
lc doctor [--json]              configuration and per-host capability negotiation
lc evolve --learner pi|dsh|claude|codex|"<command>" [--since 7d] [--max-cases N] [--timeout 30m] [--dry-run] [--json]
                                one evolution step: the learner writes rules from your evidence;
                                they are adopted only if replaying every recorded output shows a gain
                                with no output saving less, and every preservation requirement holds
lc rules [list|show|path|off|rollback] [--json]
                                the adopted rules; new sessions on every host use the active set
```

Requires Node.js 22 or newer. The package is a single self-contained file
with no dependencies. See the
[LightCode README](https://github.com/Zongwei9888/lightcode-plugins#readme) for
configuration and the [Codex plugin](https://github.com/Zongwei9888/lightcode-plugins/tree/main/adapters/codex).
