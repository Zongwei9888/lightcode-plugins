/**
 * The DeepSeek Harness Plugins page, driven like a user: install
 * @lightcode/dsh by name, enable it, work in a chat, read `/lightcode`, change
 * Mode on the plugin's page (applied live), switch the bundle off and on, and
 * uninstall it. Shared by the Web UI (`dsh web`) and the Desktop app, which
 * embeds the same client.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COMMANDS } from './fixture.mjs'
import { BUILD_LEARNED, adoptRules, writeBuildScript } from './rules.mjs'
import { SHADOW_PROMPT, checkpointRequest, readBack, seqCommands, shadowScript } from './shadow-script.mjs'
import { toolResults } from './mock-llm.mjs'
import { delivered, journal, verifyDeliveries } from './verify.mjs'

export const COMMAND_LIST = [COMMANDS.search, COMMANDS.tests, COMMANDS.diff, COMMANDS.plain]
const PROJECTED = ['projected', 'projected', 'projected', 'passed']

/** The profile layer that points a DSH profile at the scripted model and keeps its default workspace in the run directory. */
export function mockProfilePatch(mockUrl, documentsDirectory) {
  return `- id: llm-pi-ai
  config:
    providers:
      mock:
        apiKeyEnv: MOCK_LLM_API_KEY
        api: openai-completions
        baseURL: ${mockUrl}
        models:
          # Agent presets compact at window − output − 64k headroom: about 40k tokens here.
          - id: mock-model
            contextWindow: 110000
            maxTokens: 4000
- id: agent-default-model
  config:
    provider: mock
    model: mock-model
- id: workspace-controller
  config:
    documentsDirectory: ${documentsDirectory}
`
}

/** Every scripted command ran and reached the model unfiltered: the full search, no projection notes. */
function assertUntouched(requests, what) {
  const results = delivered(requests)
  assert.equal(results.length, COMMAND_LIST.length, `${what}: the model received ${results.length} tool results`)
  const search = results[COMMAND_LIST.indexOf(COMMANDS.search)].text
  assert.equal(search.trim().split('\n').length, 270, `${what}: the search output was not delivered in full`)
  assert.ok(results.every(result => !result.text.includes('omitted')), `${what}: a projection reached the model`)
}

export async function until(check, what, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise(resolve => setTimeout(resolve, 200))
  }
}

/**
 * @param {{ page: import('playwright-core').Page, label: string, profileDir: string, lightcodeHome: string,
 *   mock: { requests: any[] }, shot: (name: string) => Promise<unknown>, log: (line: string) => void, pageErrors: string[] }} options
 */
export async function exercisePluginsPage({ page, label, profileDir, lightcodeHome, workspace, mock, shot, log, pageErrors }) {
  await page.getByRole('button', { name: 'Continue' }).click({ timeout: 30_000 }).catch(() => {})
  const decisions = () => journal(lightcodeHome, 'dsh').filter(record => record.type === 'economy/decision')
  const profile = () => JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  const patch = () => readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
  // The chat composer is a contenteditable textbox; the sidebar also has a search input.
  const composer = () => page.locator('[role=textbox][contenteditable=true]').last()
  // Leaving the Plugins panel resets it to its list, so pass through another panel first; a detail
  // page that is still open goes back through its own breadcrumb.
  const openPlugins = async () => {
    const list = page.getByRole('button', { name: 'Add plugin', exact: true })
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.getByRole('button', { name: 'New session' }).first().click()
      await page.getByRole('button', { name: 'Plugins' }).first().click()
      if (await list.waitFor({ timeout: 5_000 }).then(() => true, () => false)) return
      const crumb = page.locator('[data-plugin-detail] button, [data-plugin-row-detail] button').first()
      if (await crumb.isVisible()) await crumb.click()
      if (await list.waitFor({ timeout: 5_000 }).then(() => true, () => false)) return
    }
    await list.waitFor()
  }
  const openLightCode = async () => { await openPlugins(); await page.getByRole('button', { name: 'View LightCode' }).click(); await page.getByText('@lightcode/dsh', { exact: true }).first().waitFor() }
  const chat = async (name, prompt = 'Run the fixture commands.') => {
    const before = mock.requests.length
    await page.getByRole('button', { name: 'New session' }).first().click()
    // A fresh session can re-render under the composer just after the click: send again until the model is asked.
    for (let attempt = 0; ; attempt++) {
      const box = composer()
      await box.click()
      await box.fill(prompt)
      await page.keyboard.press('Enter')
      const sent = await until(() => mock.requests.length > before, 'the prompt to reach the model', 15_000).then(() => true, () => false)
      if (sent) break
      if (attempt === 2) throw new Error(`the prompt was not sent: ${prompt}`)
      await page.getByRole('button', { name: 'New session' }).first().click()
    }
    await page.getByText('done', { exact: true }).waitFor({ timeout: 240_000 })
    await shot(name)
    return mock.requests.slice(before)
  }
  const saveMode = async (mode) => {
    await openLightCode()
    await page.getByRole('tab', { name: mode }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).and(page.locator(':disabled')).waitFor()
  }

  // 1. Install by name from the Plugins page, then enable.
  await openPlugins()
  await page.getByRole('button', { name: 'Add plugin', exact: true }).click()
  await page.getByPlaceholder(/for example/).fill('@lightcode/dsh')
  await page.getByRole('button', { name: 'Install', exact: true }).click()
  await page.getByRole('button', { name: /Enable now/ }).waitFor({ timeout: 180_000 })
  await shot('01-installed')
  await page.getByRole('button', { name: /Enable now/ }).click()
  const card = page.locator('[data-plugin-package="@lightcode/dsh"]')
  await card.waitFor()
  assert.match(await card.innerText(), /LightCode\s+Shrinks test, build, diff and search output/)
  const icon = await card.locator('img').first().getAttribute('src')
  assert.match(icon ?? '', /^data:image\/svg\+xml/, 'the card does not show the package icon')
  await until(() => profile().dsh.profile.bundles.includes('@lightcode/dsh'), 'the bundle to be selected')
  await shot('02-card')
  log(`${label}: installed and enabled from the Plugins page ✓`)

  // 2. A chat: the model reads projections, the tool card shows them, /lightcode reports them.
  const applied = await chat('03-chat-apply')
  const summary = verifyDeliveries({ requests: applied, lightcodeHome, host: 'dsh', commands: COMMAND_LIST, expect: PROJECTED })
  // The tool cards sit in collapsed groups: the turn, then "Ran commands", then each command.
  await page.getByText(/Completed in/).first().click()
  await page.getByText('Ran commands').first().click()
  await page.getByText(`Fixture: ${COMMANDS.search}`, { exact: true }).first().click()
  await page.getByText('[search sample; omitted matches are counted above, not shown]').first().waitFor()
  await shot('04-tool-cards')
  const box = composer()
  await box.click()
  await box.fill('/lightcode')
  await page.getByRole('option', { name: /lightcode/ }).or(page.getByText('LightCode: tokens saved in this session and the current mode')).first().waitFor()
  await page.keyboard.press('Enter')
  await page.getByText(/LightCode saved ~\S+ tokens in this session \(3 of 4 outputs filtered\)/).first().waitFor()
  await shot('05-lightcode-command')
  log(`${label}: chat ✓ ${summary.map(item => `${item.filter ?? item.outcome} ${item.rawTokens}→${item.projectedTokens ?? item.rawTokens}`).join(', ')}; tool card ✓; /lightcode ✓`)

  // 2b. LightShadow inside the agent preset: a chat long enough to compact, then a recall.
  const shadow = shadowScript(seqCommands(26))
  const fixture = mock.script
  mock.setScript(shadow.script)
  let compacted
  try { compacted = await chat('05b-chat-lightshadow', SHADOW_PROMPT) } finally { mock.setScript(fixture) }
  assert.ok(shadow.state.summaries > 0, 'the preset never compacted')
  assert.ok(shadow.state.recalledId, 'the model found no catalog or no recall tool after compaction')
  checkpointRequest(compacted)
  const { checkpoints } = readBack(compacted, shadow.state.recalledId, lightcodeHome, 'dsh')
  const box2 = composer()
  await box2.click()
  await box2.fill('/lightcode')
  await page.getByRole('option', { name: /lightcode/ }).or(page.getByText('LightCode: tokens saved in this session and the current mode')).first().waitFor()
  await page.keyboard.press('Enter')
  await page.getByText(/LightShadow: \d+ compactions?, \d+ long results? cut, \d+ tool results kept recallable/).first().waitFor()
  await shot('05c-lightcode-lightshadow')
  log(`${label}: LightShadow in the agent preset ✓ (${checkpoints.map(record => record.kind).join(', ')}); recall ✓; /lightcode ✓`)

  // 2c. A learned rule (as lc evolve adopts one) applies in the next session: the rule sandbox runs in the host's process.
  writeBuildScript(workspace)
  const adopted = adoptRules(lightcodeHome)
  mock.setScript({ commands: ['./build.sh'], toolArguments: command => ({ description: `Fixture: ${command}`, command }) })
  let built
  try { built = await chat('05d-chat-learned-rule') } finally { mock.setScript(fixture) }
  assert.equal(toolResults(built.at(-1)).at(-1)?.text, BUILD_LEARNED, 'the learned rule did not apply')
  const learned = decisions().at(-1)
  assert.equal(learned.rule, 'build-progress')
  assert.equal(learned.learnedRulesHash, adopted)
  log(`${label}: learned rule applied in a new session ✓`)

  // 3. Mode on the plugin's page, applied to the next tool call without a restart.
  await saveMode('Observe')
  await until(() => /mode: observe/.test(patch()), 'mode: observe in the profile patch')
  await shot('06-mode-observe')
  const lcObserveBefore = decisions().length
  const observed = await chat('07-chat-observe')
  assert.deepEqual(decisions().slice(lcObserveBefore).map(record => record.outcome), ['previewed', 'previewed', 'previewed', 'passed'])
  for (const [index, result] of delivered(observed).entries()) {
    const record = decisions().slice(lcObserveBefore)[index]
    assert.equal(createHash('sha256').update(result.text).digest('hex'), record.raw.sha256, 'observe mode changed what the model read')
  }
  await saveMode('Off')
  const offBefore = decisions().length
  assertUntouched(await chat('08-chat-off'), 'Off')
  assert.equal(decisions().length, offBefore, 'Off still recorded decisions')
  await openLightCode()
  await page.getByRole('button', { name: 'Reset to default' }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('tab', { name: 'Apply', selected: true }).waitFor()
  await until(() => !/mode: (observe|off)/.test(patch()), 'the mode override to be cleared')
  log(`${label}: Mode observe/off/reset from the plugin page, live ✓`)

  // 4. Switch the bundle off and on from the Plugins page.
  await openPlugins()
  await page.getByRole('button', { name: 'Disable LightCode' }).or(card.getByRole('switch')).first().click()
  await page.getByRole('button', { name: 'Enable LightCode' }).or(card.getByRole('switch', { checked: false })).first().waitFor()
  await until(() => !profile().dsh.profile.bundles.includes('@lightcode/dsh'), 'the bundle to be deselected')
  const disabledBefore = decisions().length
  assertUntouched(await chat('09-chat-bundle-off'), 'a switched-off bundle')
  assert.equal(decisions().length, disabledBefore, 'a switched-off bundle still filtered')
  await openPlugins()
  await page.getByRole('button', { name: 'Enable LightCode' }).or(card.getByRole('switch')).first().click()
  await page.getByRole('button', { name: 'Disable LightCode' }).or(card.getByRole('switch', { checked: true })).first().waitFor()
  await until(() => profile().dsh.profile.bundles.includes('@lightcode/dsh'), 'the bundle to be selected again')
  const again = await chat('10-chat-bundle-on')
  verifyDeliveries({ requests: again, lightcodeHome, host: 'dsh', commands: COMMAND_LIST, expect: PROJECTED })
  log(`${label}: bundle off/on ✓`)

  // 5. Uninstall from the plugin's page.
  await openLightCode()
  await page.getByRole('button', { name: 'Uninstall' }).first().click()
  await shot('11-uninstall-confirm')
  await page.getByRole('dialog').getByRole('button', { name: /Uninstall/ }).click()
  await card.waitFor({ state: 'detached', timeout: 120_000 })
  await until(() => profile().dependencies?.['@lightcode/dsh'] === undefined && !profile().dsh.profile.bundles.includes('@lightcode/dsh'),
    'the package and its bundle to leave the profile', 120_000)
  await shot('12-uninstalled')
  assert.deepEqual(pageErrors, [], `browser errors: ${pageErrors.join('\n')}`)
  log(`${label}: uninstall ✓`)
}
