# End-to-end suite

Installs the packages exactly as users will — by name, from a registry,
through each host's own plugin commands and UI — into published host
releases, runs real sessions, and checks what the model received.

```sh
pnpm install && pnpm build
pnpm e2e                 # everything
pnpm e2e dsh pi          # a subset: dsh, pi, shadow, evolve, pi-tui, web, desktop
```

| Scenario | What it does |
|---|---|
| `dsh` | `dsh plugin add @lightcode/dsh`, headless sessions in apply and observe mode, the session log, `dsh plugin remove` — on every DSH version |
| `pi` | `pi install npm:@lightcode/pi`, print-mode sessions, `--lightcode observe`, `pi remove`, and a checkout install — on every pi version |
| `shadow` | LightShadow on every DSH and pi version: a headless session long enough to compact, then the model recalls a compacted result; checks the checkpoint (summary, the user's words, the catalog), that the recall is exactly what the model first read, and the journal |
| `evolve` | self-evolution across hosts: the plugins in DSH and pi record evidence, `lc evolve` from the registry's `@lightcode/cli` runs a scripted learner, verifies and adopts its rule, new DSH and pi sessions apply it, and `lc rules rollback` undoes it |
| `pi-tui` | pi's TUI through tmux: the status bar, `/lightcode`, and switching the extension off and on in `pi config` |
| `web` | the DSH Web UI in Chrome: Plugins → Add plugin → Enable, a chat and its tool cards, `/lightcode`, a long chat that compacts inside the agent preset and recalls a result, Mode on the plugin page (applied live), bundle off/on, uninstall |
| `desktop` | the same Plugins-page flow inside the DSH Desktop app (Electron, its bundled pnpm, `profiles/desktop`); needs `LIGHTCODE_E2E_DESKTOP_APP`, skipped otherwise |

How it works:

- `scripts/bundle.mjs` output is packed with `pnpm pack` and published to a
  throwaway [verdaccio](https://verdaccio.org) registry on 127.0.0.1, which
  proxies every other package to npm.
- A scripted OpenAI-compatible model (`lib/mock-llm.mjs`) calls `bash` with a
  fixed list of commands against a small fixture project (`lib/fixture.mjs`)
  and records every request, so the checks read exactly what the model
  received: each tool result must hash to the projection (or the untouched
  original) that LightCode journaled, and every projected original must be in
  LightCode's store.
- Hosts and tools are installed once into `e2e/.cache` (or
  `$LIGHTCODE_E2E_CACHE`). Each run uses its own `DSH_HOME`, pi agent
  directory, `LIGHTCODE_HOME` and, for the Web UI, `HOME` and Documents
  directory; nothing touches `~/.dsh`, `~/.pi` or `~/.lightcode`.

Requirements: Node.js 22, git, network access to the npm registry for the
first run, Google Chrome (for `web`; set `LIGHTCODE_E2E_BROWSER_CHANNEL` to use
another Playwright channel, or `LIGHTCODE_E2E_BROWSER_PATH` for a Chromium
binary), tmux (for `pi-tui`, skipped otherwise) and zstd (to read DSH session
logs; that check is skipped otherwise). On Linux, DeepSeek Harness runs `bash`
only inside its bubblewrap sandbox: install `bubblewrap` and allow
unprivileged user namespaces (on Ubuntu 24.04:
`sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`).

| Variable | Default |
|---|---|
| `LIGHTCODE_E2E_DSH` | `0.2.0-rc.2,0.2.1-alpha.2` |
| `LIGHTCODE_E2E_PI` | `1.1.0,1.2.0` |
| `LIGHTCODE_E2E_PNPM` | `11.28.5` (`dsh plugin` needs pnpm 11 or later) |
| `LIGHTCODE_E2E_CACHE` | `e2e/.cache` |
| `LIGHTCODE_E2E_TMP` | the OS temp directory |
| `LIGHTCODE_E2E_KEEP=1` | keep the run directory (it is always kept on failure) |
| `LIGHTCODE_E2E_DESKTOP_APP` | an unpacked `DeepSeek Harness.app` (macOS only: Desktop is built for macOS and Windows, and the scenario drives the macOS app); Desktop is not on npm: copy the app out of the official DMG (`https://download.deepseek.com/desktop/dsh-latest-macos-arm64.dmg`), or build one in a DeepSeek Harness checkout with `pnpm install && pnpm run build && pnpm run package:desktop:mac:arm64:dir`. The app runs with its own `DSH_HOME`, user data and Documents directory; its window appears while the scenario runs |
