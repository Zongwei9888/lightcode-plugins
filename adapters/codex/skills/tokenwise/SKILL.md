---
name: tokenwise
description: Learn TokenWise output filters from recorded sessions, follow or cancel a learning run, and list, switch off or roll back learned filters. Use when the user types $tokenwise or asks TokenWise to learn, or asks about its learned filters.
---

# TokenWise

Run exactly one of these commands, the one that matches what the user asked
(learn when they did not say), then tell them what it printed in one or two
sentences, in their language.

| The user asks to | Command |
|---|---|
| learn | `tokenwise learn --learner codex` |
| see how learning is going | `tokenwise learn status` |
| stop learning | `tokenwise learn cancel` |
| see the learned filters | `tokenwise rules` |
| switch them off, or on again | `tokenwise rules off`, `tokenwise rules on` |
| undo the last adoption | `tokenwise rules rollback` |

These commands write to `~/.tokenwise`, and learning starts a background
process that uses the network, so run them outside the sandbox: request
escalated permissions, saying it is to run TokenWise. A learning run continues
in the background; do not wait for it or check on it.
