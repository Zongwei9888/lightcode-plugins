import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Tests run against workspace sources, never stale builds.
const packages = fileURLToPath(new URL('./packages/', import.meta.url))
const alias = Object.fromEntries(readdirSync(packages).map(name => [`@lightcode-ai/${name}`, `${packages}${name}/src/index.ts`]))

export default defineConfig({
  resolve: { alias },
  test: { include: ['test/**/*.spec.ts'], globalSetup: [fileURLToPath(new URL('./vitest.tmpdir.ts', import.meta.url))] },
})
