# lc — the LightCode command

```sh
npm install -g @lightcode/cli
lc doctor
```

`lc` runs any command with LightCode's output filtering, serves the Codex
hook, and reports what LightCode saved on every host (pi, DeepSeek Harness,
Codex).

```
lc run -c '<script>'            run with your shell, print the filtered output (exit code and signals pass through)
lc run -- <program> [args...]   run a program directly
lc hook codex                   Codex PreToolUse hook handler (reads hook JSON on stdin)
lc report [--host H] [--session S] [--json]   savings; a session includes its subagent sessions
lc filters [--json]             every filter and what it preserves
lc show <sha256>                print a saved original
lc gc [--days N]                delete saved originals older than N days
lc doctor [--json]              configuration and per-host capability negotiation
```

Requires Node.js 22 or newer. The package is a single self-contained file
with no dependencies. See the
[LightCode README](https://github.com/Zongwei9888/lightcode-plugins#readme) for
configuration and the [Codex plugin](https://github.com/Zongwei9888/lightcode-plugins/tree/main/adapters/codex).
