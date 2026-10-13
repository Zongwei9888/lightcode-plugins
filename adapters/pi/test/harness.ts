/** Drive a real pi 1.1 session with the faux model provider, recording what the model receives. */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent'
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from '@earendil-works/pi-ai/compat'

export interface PiRun {
  /** Tool-result contents of every request after the first, as the provider received them. */
  readonly seen: unknown[][]
  readonly sessionFile: string
  readonly sessionId: string
}

/** A scripted tool call; a plain string is a bash command. */
export type PiCall = string | { readonly tool: string; readonly args: Parameters<typeof fauxToolCall>[1] }

export async function runPi(options: { cwd: string; extension: ExtensionFactory; commands: PiCall[] }): Promise<PiRun> {
  const dir = mkdtempSync(join(tmpdir(), 'lightcode-pi-'))
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
