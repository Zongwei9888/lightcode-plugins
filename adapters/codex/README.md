# LightCode for Codex

A Codex plugin with one `PreToolUse` hook. For a shell command that a
LightCode filter may recognize (test runners, compilers, `git status/diff`,
`grep`/`rg`, `find`, `ls`, build tools, …) the hook rewrites

```
cargo test
```

to

```
lc run --host codex --session <thread> --call <call> -c 'cargo test'
```

`lc run` executes the original script with your shell, keeps the exit code
and signals, saves the original output under `~/.lightcode`, and prints a
smaller, deterministic projection when one is admitted (strictly fewer bytes
and tokens). Every other command is left alone.

Verified against Codex 0.162.1 source:

- The model's history keeps the original command; Codex still applies its
  exec policy, approval and sandbox to the rewritten one.
- Hooks from plugins (and `~/.codex/hooks.json`) run only after you trust
  them in `/hooks` or the startup review. Editing the hook revokes trust.
- `lc` must be on the `PATH` of the shell Codex uses
  (`npm install -g @lightcode/cli`, then `lc doctor`).
- Long-running commands show their output when they finish, not while they
  run.

## Install

Either install this directory as a local Codex plugin, or copy
`hooks/hooks.json` to `~/.codex/hooks.json` (or a project's
`.codex/hooks.json`). Then start Codex, trust the hook, and check savings
with `lc report --host codex`.

Disable at any time with `LIGHTCODE_DISABLE=1`, or set
`{"economy": {"mode": "observe"}}` in `~/.lightcode/config.json` to record
what would change without changing anything.
