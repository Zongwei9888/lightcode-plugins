# RTK built-in filter data

Source: https://github.com/rtk-ai/rtk

Pinned commit: `f7495466edf7d2ed93d6ea4d2caab18dc8806b5a` (develop, retrieved 2026-09-08).

The built-in TOML filter definitions and inline test examples are redistributed as TypeScript data under RTK's Apache-2.0 license (LICENSE alongside this file). File hashes are retained in `packages/core/src/rtk/catalog.ts`. The TypeScript execution adapter and host integrations are TokenWise modifications, not upstream RTK code.

This is NOT the whole RTK Rust command implementation. The accompanying command-module inventory records the remaining comparison surface. Runtime loading of project/user TOML and command execution are deliberately absent; only pinned built-in data is loaded.
