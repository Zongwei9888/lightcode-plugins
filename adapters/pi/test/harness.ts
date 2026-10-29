/** Drive a real pi 1.1 session with the faux model provider, recording what the model receives. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished } from 'vitest'
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent'
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from '@earendil-works/pi-ai/compat'

/** pi's agent directory for one run, removed when the test ends (tests read the session file after the run). */
function agentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tokenwise-pi-'))
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

export interface PiRun {
  /** Tool-result contents of every request after the first, as the provider received them. */
  readonly seen: unknown[][]
  readonly sessionFile: string
  readonly sessionId: string
}

/** A scripted tool call; a plain string is a bash command. */
export type PiCall = string | { readonly tool: string; readonly args: Parameters<typeof fauxToolCall>[1] }

export async function runPi(options: { cwd: string; extension: ExtensionFactory; commands: PiCall[] }): Promise<PiRun> {
  const dir = agentDir()
  const faux = registerFauxProvider()
  const model = faux.getModel()
  try {
    const modelRuntime = await ModelRuntime.create({ modelsPath: null, authPath: join(dir, 'auth.json'), allowModelNetwork: false })
    modelRuntime.registerProvider(model.provider, {
      baseUrl: model.baseUrl, apiKey: 'faux-key', api: faux.api,
      models: [{ id: model.id, name: model.name, api: model.api, reasoning: model.reasoning, input: model.input,
        cost: model.cost, contextWindow: model.contextWindow, maxTokens: model.maxTokens, baseUrl: model.baseUrl }],
    })
    const resourceLoader = new DefaultResourceLoader({ cwd: options.cwd, agentDir: dir, extensionFactories: [options.extension],
      noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true })
    await resourceLoader.reload()
    const { session } = await createAgentSession({ cwd: options.cwd, agentDir: dir, model, modelRuntime, resourceLoader, tools: ['bash', 'grep', 'find'],
      sessionManager: SessionManager.create(options.cwd, join(dir, 'sessions')), settingsManager: SettingsManager.inMemory() })
    await session.bindExtensions({})
    const seen: unknown[][] = []
    const capture = (context: { messages: { role: string; content: unknown }[] }) =>
      seen.push(context.messages.filter(message => message.role === 'toolResult').map(message => message.content))
    faux.setResponses([
      ...options.commands.map((command, index) => (context: { messages: { role: string; content: unknown }[] }) => {
        if (index > 0) capture(context)
        const call = typeof command === 'string' ? { tool: 'bash', args: { command } } : command
        return fauxAssistantMessage(fauxToolCall(call.tool, call.args), { stopReason: 'toolUse' })
      }),
      (context: { messages: { role: string; content: unknown }[] }) => { capture(context); return fauxAssistantMessage('done') },
    ])
    await session.prompt('go')
    const result = { seen, sessionFile: session.sessionManager.getSessionFile()!, sessionId: session.sessionManager.getSessionId() }
    session.dispose()
    return result
  } finally {
    faux.unregister()
  }
}

export const textOf = (content: unknown): string =>
  (content as { type: string; text?: string }[]).map(block => block.text ?? '').join('')

type FauxContext = { messages: { role: string; content: unknown }[] }
export type FauxStep = (context: FauxContext) => ReturnType<typeof fauxAssistantMessage>

/**
 * Two prompts with a manual `/compact` between them. Each step answers one
 * provider request; `requests` records every request's messages.
 */
export async function runPiWithCompaction(options: {
  cwd: string; extension: ExtensionFactory; before: PiCall[]; after: FauxStep[]; tools?: string[]
}): Promise<PiRun & { requests: FauxContext['messages'][]; compaction: unknown; activeTools: string[] }> {
  const dir = agentDir()
  const faux = registerFauxProvider()
  const model = faux.getModel()
  try {
    const modelRuntime = await ModelRuntime.create({ modelsPath: null, authPath: join(dir, 'auth.json'), allowModelNetwork: false })
    modelRuntime.registerProvider(model.provider, {
      baseUrl: model.baseUrl, apiKey: 'faux-key', api: faux.api,
      models: [{ id: model.id, name: model.name, api: model.api, reasoning: model.reasoning, input: model.input,
        cost: model.cost, contextWindow: model.contextWindow, maxTokens: model.maxTokens, baseUrl: model.baseUrl }],
    })
    const resourceLoader = new DefaultResourceLoader({ cwd: options.cwd, agentDir: dir, extensionFactories: [options.extension],
      noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true })
    await resourceLoader.reload()
    const { session } = await createAgentSession({ cwd: options.cwd, agentDir: dir, model, modelRuntime, resourceLoader, ...options.tools ? { tools: options.tools } : {},
      sessionManager: SessionManager.create(options.cwd, join(dir, 'sessions')),
      settingsManager: SettingsManager.inMemory({ compaction: { enabled: false, reserveTokens: 16384, keepRecentTokens: 1 } }) })
    await session.bindExtensions({})
    const requests: FauxContext['messages'][] = []
    const record = (context: FauxContext) => { requests.push(structuredClone(context.messages)) }
    faux.setResponses([
      ...options.before.map(command => (context: FauxContext) => {
        record(context)
        const call = typeof command === 'string' ? { tool: 'bash', args: { command } } : command
        return fauxAssistantMessage(fauxToolCall(call.tool, call.args), { stopReason: 'toolUse' })
      }),
      (context: FauxContext) => { record(context); return fauxAssistantMessage('first part done') },
    ])
    await session.prompt('Fix the KeyError in retry_backoff. Do not change the public API.')
    // pi's own summarizer answers from the faux model when LightShadow leaves the compaction to pi.
    faux.setResponses([fauxAssistantMessage('pi summary of the history'), fauxAssistantMessage('pi summary of the turn prefix')])
    const compaction = await session.compact()
    faux.setResponses(options.after.map(step => (context: FauxContext) => { record(context); return step(context) }))
    await session.prompt('continue')
    const result = { seen: [], sessionFile: session.sessionManager.getSessionFile()!, sessionId: session.sessionManager.getSessionId(),
      requests, compaction, activeTools: session.getActiveToolNames() }
    session.dispose()
    return result
  } finally {
    faux.unregister()
  }
}

export { fauxAssistantMessage, fauxToolCall }
