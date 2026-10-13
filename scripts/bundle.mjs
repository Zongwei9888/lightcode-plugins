#!/usr/bin/env node
/**
 * Build the self-contained files the distributable packages ship. Each one
 * carries the LightCode packages it uses inline, so installing `@lightcode/pi`,
 * `@lightcode/dsh` or `@lightcode/cli` needs no other LightCode package; the
 * host's own modules stay external and come from the running host.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('..', import.meta.url))
const at = (...parts) => join(root, ...parts)
const LICENSE_BANNER = name => `/*! ${name} — MIT License. Bundles the LightCode packages; the RTK filter data inside is Apache-2.0 (see NOTICE.md). */`

const node = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Workspace packages resolve to their TypeScript sources, so a bundle never picks up a stale lib/.
  conditions: ['source'],
  legalComments: 'inline',
  logLevel: 'warning',
  charset: 'utf8',
}

async function bundleNode({ entry, outfile, external, name, executable = false }) {
  await build({ ...node, entryPoints: [at(entry)], outfile: at(outfile), external,
    banner: { js: `${executable ? '#!/usr/bin/env node\n' : ''}${LICENSE_BANNER(name)}` } })
}

/**
 * The DSH Web client loads a browser half as one script that registers a
 * factory with the page's module loader; the factory receives `require` for
 * the shared modules (React, the client primitives) and returns the exports.
 */
async function bundleDshClient() {
  const result = await build({
    bundle: true, platform: 'browser', format: 'cjs', target: 'es2022', write: false, charset: 'utf8',
    conditions: ['source'], legalComments: 'none', logLevel: 'warning',
    entryPoints: [at('adapters/dsh/src/client/index.ts')],
    external: ['react', 'react/jsx-runtime', '@deepseek-ai/*'],
  })
  const code = result.outputFiles[0].text
  const wrapped = `${LICENSE_BANNER('@lightcode/dsh (browser half)')}
window.__ModuleLoader__.load({
\tid: "@lightcode/dsh",
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
// The bundle is inserted verbatim: re-indenting it would change multi-line string literals.
${code}
\t\treturn module.exports;
\t}
});
`
  mkdirSync(at('adapters/dsh/lib'), { recursive: true })
  writeFileSync(at('adapters/dsh/lib/client.js'), wrapped)
}

const RTK_COMMIT = readFileSync(at('third-party/rtk/NOTICE.md'), 'utf8').match(/`([0-9a-f]{40})`/)[1]

/** Each bundled package carries LightCode's license, RTK's license and a notice naming both. */
function writeLegal(dir, name) {
  copyFileSync(at('LICENSE'), at(dir, 'LICENSE'))
  copyFileSync(at('third-party/rtk/LICENSE'), at(dir, 'LICENSE.rtk'))
  writeFileSync(at(dir, 'NOTICE.md'), `# Notices

\`${name}\` is part of LightCode (https://github.com/Zongwei9888/lightcode-plugins), MIT
licensed (see \`LICENSE\`). Its JavaScript bundles include the LightCode packages
it uses.

The bundles also contain filter definitions generated from the built-in TOML
filters of RTK (https://github.com/rtk-ai/rtk) at commit \`${RTK_COMMIT}\`,
redistributed under the Apache License 2.0 (see \`LICENSE.rtk\`). The
TypeScript code that executes them is LightCode code under the MIT license.
`)
}

for (const [dir, name] of [['adapters/pi', '@lightcode/pi'], ['adapters/dsh', '@lightcode/dsh'], ['packages/cli', '@lightcode/cli']]) writeLegal(dir, name)
// The library packages are published as they are; they carry the project license (and core the RTK one).
for (const dir of ['packages/core', 'packages/protocol', 'packages/store', 'packages/mechanisms']) copyFileSync(at('LICENSE'), at(dir, 'LICENSE'))
copyFileSync(at('third-party/rtk/LICENSE'), at('packages/core', 'LICENSE.rtk'))

await Promise.all([
  bundleNode({ entry: 'adapters/pi/src/extension.ts', outfile: 'adapters/pi/dist/extension.js', name: '@lightcode/pi',
    external: ['@earendil-works/*', 'typebox'] }),
  bundleNode({ entry: 'adapters/dsh/src/index.ts', outfile: 'adapters/dsh/lib/index.js', name: '@lightcode/dsh',
    external: ['@deepseek-ai/*'] }),
  bundleNode({ entry: 'packages/cli/src/main.ts', outfile: 'packages/cli/dist/lc.js', name: '@lightcode/cli',
    external: [], executable: true }),
  bundleDshClient(),
])
console.log('bundled @lightcode/pi, @lightcode/dsh (Host and browser halves) and @lightcode/cli')
