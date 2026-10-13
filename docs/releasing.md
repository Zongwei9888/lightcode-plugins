# Releasing

The packages users install are `@lightcode/pi`, `@lightcode/dsh` and
`@lightcode/cli`. Each is one self-contained bundle (`scripts/bundle.mjs`) with
no runtime dependencies, plus `LICENSE`, `LICENSE.rtk` (the bundled RTK filter
data is Apache-2.0) and `NOTICE.md`, all generated at build time. The library
packages (`@lightcode/core`, `protocol`, `store`, `mechanisms`) are published
for people who build their own adapters; the plugins do not depend on them.

## Once

- Create the `@lightcode` organization on npm (or rename the packages) and
  enable two-factor publishing.
- Create the GitHub repository the manifests point at
  (`github.com/Zongwei9888/lightcode-plugins`), or update `repository`/`homepage` in
  every `package.json`.

## Every release

1. Set the same version in every `package.json` and in
   `packages/cli/src/doctor.ts` (`VERSION`; a test checks they agree), and add
   the release to `CHANGELOG.md`.
2. Verify:

   ```sh
   pnpm install --frozen-lockfile
   pnpm check
   pnpm e2e                      # pi 1.1/1.2, DeepSeek Harness 0.2.0-rc.2/0.2.1-alpha.2, Web UI, pi TUI
   ```

   Update `LIGHTCODE_E2E_DSH` / `LIGHTCODE_E2E_PI` defaults in
   `e2e/lib/hosts.mjs` when a new host release should be supported, and widen
   the `@deepseek-ai/dsh-tools` peer range in `adapters/dsh/package.json` only
   after the suite passes on it (DeepSeek Harness refuses to install a plugin
   whose `@deepseek-ai/dsh*` peer range excludes the running version).
3. Inspect what will be published:

   ```sh
   for dir in adapters/pi adapters/dsh packages/cli; do (cd $dir && npm pack --dry-run); done
   ```

4. Publish (pnpm rewrites `workspace:` ranges):

   ```sh
   pnpm -r publish --access public
   ```

5. Tag `vX.Y.Z`, push the tag, and create the GitHub release from the
   changelog entry.
6. Smoke-test the published packages on a clean machine or account:

   ```sh
   pi install npm:@lightcode/pi
   dsh plugin --profile web add @lightcode/dsh       # or Plugins → Add plugin
   npm install -g @lightcode/cli && lc doctor
   ```

The `pi-package` keyword lists `@lightcode/pi` in the pi package gallery; the
`dsh-plugin` keyword marks `@lightcode/dsh` for DeepSeek Harness users.
