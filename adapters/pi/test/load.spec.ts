import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent'

describe('pi package loading', () => {
  it('loads the published bundle through pi\'s own loader and package manifest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lightcode-pi-load-'))
    try {
      const packageDir = fileURLToPath(new URL('..', import.meta.url))
      const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, additionalExtensionPaths: [packageDir],
        noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true })
      await loader.reload()
      const { errors, extensions } = loader.getExtensions()
      expect(errors).toEqual([])
      expect(extensions).toHaveLength(1)
      const extension = extensions[0]!
      expect(extension.path).toContain('dist/extension.js')
      expect([...extension.flags.keys()]).toContain('lightcode')
      expect([...extension.handlers.keys()].sort()).toEqual(['session_before_compact', 'session_start', 'tool_call', 'tool_result', 'turn_end'])
      expect([...extension.tools.keys()]).toEqual(['lightcode_recall'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
