# LightCode for Hermes Agent

A Hermes plugin (`lightcode/`) on the `transform_terminal_output` hook. Hermes
hands it the merged output of each finished foreground `terminal` command
after bounding the capture, before its output limit, ANSI stripping and
secret redaction. The plugin passes the command, output and exit code to
`lc hook hermes`; when a LightCode filter recognizes the output (test
runners, compilers, `git status/diff`, `grep`/`rg`, `find`, `ls`, build
tools, …) the model reads a smaller, deterministic projection, and the
original is saved under `~/.lightcode`. Commands run as the model wrote
them, so Hermes's approvals are untouched.

Verified against Hermes Agent 0.22.5 by loading the plugin through Hermes's
own plugin manager and running real commands through its `terminal` tool:
the model-bound result of `ls -la pkg` went from 4,197 to 1,350 bytes, and
`find . -name '*.py'` from 1,252 to 1,037.

- Output Hermes cut to a head and tail (`... [OUTPUT TRUNCATED - …] ...`),
  commands it stopped (`[Command interrupted]`, `[Command timed out …]`) and
  background-process output pass through. Output under 256 characters is
  left alone without starting `lc`.
- `transform_terminal_output` carries no session ID, so the plugin also
  observes `pre_tool_call` (without a directive) to journal each call under
  its session.
- Fail-open: no `lc`, a timeout (10 s) or any error leaves Hermes's output
  as it was. The plugin finds `lc` on `PATH`, else in `~/.local/bin`,
  `/opt/homebrew/bin` or `/usr/local/bin` (a gateway started at login may
  have a shorter `PATH`); `LIGHTCODE_LC` names it explicitly.

## LightShadow (full, as a context engine)

```sh
hermes config set context.engine lightcode     # back: hermes config set context.engine compressor
```

The `lightcode` engine (`lightcode/shadow.py`) is Hermes's own
`ContextCompressor` with your `compression:` settings, plus: the summarizer
is told the tool results stay recoverable; before Hermes assembles the
compacted history, every tool result it compacted or shortened is saved
(`lc shadow checkpoint`) and the summary gets the catalog; results Hermes
shortened in the kept head are marked with their ID; and the model gets a
`lightcode_recall` tool (`lc recall`). Verified on 0.22.5 with a real model.
Any failure falls back to Hermes's own compaction.

## Install

Hermes runs every session in one gateway process, and user plugins are off
until enabled:

```sh
npm install -g @lightcode-ai/cli            # or: npm install -g ./packages/cli from a checkout
cp -R adapters/hermes/lightcode ~/.hermes/plugins/lightcode
hermes plugins enable lightcode
```

Check savings with `lc report --host hermes`. `hermes plugins disable
lightcode` turns it off; `LIGHTCODE_DISABLE=1` turns it off for one process.
