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

Verified against Codex 0.162.1, from its source and in real `codex exec`
sessions:

- The model's history keeps the original command; Codex still applies its
  exec policy, approval and sandbox to the rewritten one. Codex's own display
  (the TUI and `codex exec --json`) shows the wrapped `lc run …` command.
- Hooks from plugins (and `~/.codex/hooks.json`) run only after you trust
  them in `/hooks` or the startup review. Editing the hook revokes trust.
  `codex exec` skips untrusted hooks silently, so trust the hook once in the
  interactive TUI first.
- Codex caps one command's output at 10,000 tokens by default and keeps the
  head and tail of anything larger. Below that cap a projection is a direct
  saving; above it Codex's cap still applies, and the projection means more
  of the result fits inside it.
- `lc` must be on the `PATH` of the shell Codex uses
  (`npm install -g @lightcode-ai/cli`, then `lc doctor`).
- Long-running commands show their output when they finish, not while they
  run.
- Wrapped commands run inside Codex's sandbox. With `workspace-write`,
  `~/.lightcode` is not writable, so `lc run` keeps originals in a private
  `$TMPDIR/lightcode-<uid>` directory instead (`lc report` reads both). To
  keep everything in one place, add `~/.lightcode` (as an absolute path) to
  `sandbox_workspace_write.writable_roots`. In `read-only` mode nothing can be
  saved, so nothing is filtered.

## Install

From a checkout of this repository (it doubles as a Codex marketplace):

```sh
codex plugin marketplace add /path/to/lightcode
codex plugin add lightcode@lightcode
```

Or copy `hooks/hooks.json` to `~/.codex/hooks.json` (or a project's
`.codex/hooks.json`). Then start Codex, trust the hook in `/hooks`, and check
savings with `lc report --host codex`.

Disable at any time with `LIGHTCODE_DISABLE=1`, or set
`{"economy": {"mode": "observe"}}` in `~/.lightcode/config.json` to record
what would change without changing anything.
