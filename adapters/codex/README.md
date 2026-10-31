# TokenWise for Codex

A Codex plugin with one `PreToolUse` hook. For a shell command that a
TokenWise filter may recognize (test runners, compilers, `git status/diff`,
`grep`/`rg`, `find`, `ls`, build tools, …) the hook rewrites

```
cargo test
```

to

```
tokenwise run --host codex --session <thread> --call <call> -c 'cargo test'
```

`tokenwise run` executes the original script with your shell, keeps the exit code
and signals, saves the original output under `~/.tokenwise`, and prints a
smaller, deterministic projection when one is admitted (strictly fewer bytes
and tokens). Every other command is left alone.

Verified against Codex 0.162.1, from its source and in real `codex exec`
sessions:

- The model's history keeps the original command; Codex still applies its
  exec policy, approval and sandbox to the rewritten one. Codex's own display
  (the TUI and `codex exec --json`) shows the wrapped `tokenwise run …` command.
- Hooks from plugins (and `~/.codex/hooks.json`) run only after you trust
  them in `/hooks` or the startup review. Editing the hook revokes trust.
  `codex exec` skips untrusted hooks silently, so trust the hook once in the
  interactive TUI first.
- Codex caps one command's output at 10,000 tokens by default and keeps the
  head and tail of anything larger. Below that cap a projection is a direct
  saving; above it Codex's cap still applies, and the projection means more
  of the result fits inside it.
- `tokenwise` must be on the `PATH` of the shell Codex uses
  (`npm install -g @tokenwise/cli`, then `tokenwise doctor`).
- Long-running commands show their output when they finish, not while they
  run.
- Wrapped commands run inside Codex's sandbox. With `workspace-write`,
  `~/.tokenwise` is not writable, so `tokenwise run` keeps originals in a private
  `$TMPDIR/tokenwise-<uid>` directory instead (`tokenwise report` reads both). To
  keep everything in one place, add `~/.tokenwise` (as an absolute path) to
  `sandbox_workspace_write.writable_roots`. In `read-only` mode nothing can be
  saved, so nothing is filtered.

## Compaction (assisted)

Codex writes the summary itself (for OpenAI models an opaque compaction
item), but after every compaction it runs SessionStart hooks with source
`compact` and adds their context before the next request (verified on
0.165.0):

- the hook reads the rollout, saves the tool outputs between the last two
  compactions (labelled by the shell commands each `exec` ran), and adds the
  catalog of every reference the session has; `additionalContextLimit` is
  raised to 6,000 tokens so Codex does not spill it to a file;
- the plugin's MCP server (`.mcp.json`) offers `mcp__tokenwise__tokenwise_recall`,
  annotated read-only, so `codex exec` runs it without asking; the catalog
  shows the code-mode call (`await tools.mcp__tokenwise__tokenwise_recall({…})`).

Subagent threads get no SessionStart(compact), so no catalog. After you
install or update the plugin, trust its hooks again in `/hooks`.

## Learning

The plugin's `tokenwise` skill learns with Codex as the learner: type
`$tokenwise learn` (or ask Codex to have TokenWise learn), `$tokenwise status`
or `$tokenwise rules`. The command writes to `~/.tokenwise` and the learner
needs the network, so Codex asks to run it outside the sandbox. At startup the
plugin says when recorded output is worth learning from and when a run has
finished.

## Install

From a checkout of this repository (it doubles as a Codex marketplace):

```sh
codex plugin marketplace add /path/to/tokenwise
codex plugin add tokenwise@tokenwise
```

Or copy `hooks/hooks.json` to `~/.codex/hooks.json` (or a project's
`.codex/hooks.json`). Then start Codex, trust the hook in `/hooks`, and check
savings with `tokenwise report --host codex`.

Disable at any time with `TOKENWISE_DISABLE=1`, or set
`{"output": {"mode": "observe"}}` in `~/.tokenwise/config.json` to record
what would change without changing anything.
