---
description: Learn TokenWise output filters from your recorded sessions, in the background
argument-hint: "[status | cancel]"
allowed-tools: Bash(tokenwise learn:*)
---
Run exactly one of these commands with the Bash tool, and nothing else:

- `tokenwise learn status` if the user asked for the status
- `tokenwise learn cancel` if the user asked to cancel or stop
- `tokenwise learn --learner claude` otherwise

What the user typed after the command: $ARGUMENTS

Then tell the user what it printed, in one or two sentences and in their language.
A learning run continues in the background; do not wait for it or check on it.
