# Output filter conformance corpus

`corpus.json` holds tool outputs; `expected.<runtime-version>.json` holds the
exact projection every TokenWise implementation must produce for them
(`null` = the output must pass through unchanged). Any host adapter that
filters through `@tokenwise/core` must reproduce these bytes and source maps.

- `captured/*` — real outputs of git, grep, find, ls, pytest, tsc, cargo and
  `node --test`, recorded in a throwaway sandbox by `capture-inputs.mjs`.
  Sandbox paths, home paths and the local user name are replaced.
- `fixture/*` — scripted coding-tool outputs from the original test suite.
- `rtk/*` — RTK upstream inline examples (Apache-2.0, see
  `third-party/rtk/`), each run with exit code 0 and 1.
- `synthetic/*` — boundaries: CRLF, missing final newline, ANSI escapes,
  NUL bytes, CJK and emoji text, very long lines, compound commands, filter
  options and empty output.

The expectations reproduce, byte for byte, what the TokenWise research runtime
(the DeepSeek Harness plugin) produced before the code was split into
host-independent packages, so they also pin the open-source core to the
published experiments.
Changing a filter's output requires a new `ECONOMY_RUNTIME_VERSION` and a new
expected file; never edit an existing one.
