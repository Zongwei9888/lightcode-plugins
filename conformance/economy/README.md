# Output filter conformance corpus

`corpus.json` holds tool outputs; `expected.<runtime-version>.json` holds the
exact projection every TokenWise implementation must produce for them
(`null` = the output must pass through unchanged). Any host adapter that
filters through `@tokenwise/core` must reproduce these bytes and source maps.

- `captured/*` — real outputs of git, grep, find, ls, pytest, tsc, cargo and
  `node --test`, recorded in a throwaway sandbox by `capture-inputs.mjs`.
  Sandbox paths, home paths and the local user name are replaced.
- `fixture/*` — scripted coding-tool outputs from the original test suite.
- `synthetic/*` — boundaries: CRLF, missing final newline, ANSI escapes,
  NUL bytes, CJK and emoji text, very long lines, compound commands, filter
  options and empty output.

Up to `static-v11` the expectations reproduced, byte for byte, what the
TokenWise research runtime (the DeepSeek Harness plugin) produced, so they pin
the open-source core to the published experiments; `static-v12` keeps every
one of those results unchanged.

Changing a filter's output, or adding a filter, requires a new
`ECONOMY_RUNTIME_VERSION` and a new expected file; never edit an existing one.
`node --conditions=source conformance/economy/write-expected.mts <previous>`
writes the new file and lists every case that changed or is new; review that
list before committing.
