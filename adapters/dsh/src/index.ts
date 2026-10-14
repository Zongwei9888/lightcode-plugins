/**
 * LightCode for DeepSeek Harness 0.2.x, Host half. Economy: recognized `bash`
 * output, and complete results of DSH's own `grep` and `glob`, are replaced by
 * a deterministic projection in the `tools/post-execute` waterfall, so the
 * model and the session log receive the smaller text while LightCode keeps the
 * original (and a source map) in its private store. LightShadow
 * (./shadow.ts): DSH's compaction keeps tool results recallable through
 * `lightcode_recall`. `/lightcode` reports both; the `mode` setting is live.
 */
import Schema from '@deepseek-ai/schemastery'
import type { MechanismMode } from '@lightcode/protocol'
import { HOST, INLINE_LIMIT_CHARS, createDshEconomy } from './economy.ts'
import type { HostContext, Volatile } from './host.ts'
import { RECALL_TOOL, createDshShadow } from './shadow.ts'

export const name = 'lightcode'
export const inject = ['tools']

export interface Config {
  mode: Volatile<MechanismMode>
  inlineLimitChars: number
}

export const Config = Schema.object({
  mode: Schema.union(['apply', 'observe', 'off']).default('apply')
    .description('apply: the model reads smaller tool output, and compaction keeps tool results recallable; observe: record what would change, change nothing; off: do nothing.')
    .volatile(),
  inlineLimitChars: Schema.natural().default(INLINE_LIMIT_CHARS)
    .description('A projection longer than this (characters) is not used: the original passes, so DSH\'s spill policy keeps the complete text. '
      + 'Keep it at or below spill-policy maxInlineTokens × 4 (the default fits DSH\'s default 12,500).'),
})

export function apply(ctx: HostContext, config: Config): void {
  const economy = createDshEconomy({
    mode: () => config.mode.get(),
    inlineLimitChars: config.inlineLimitChars,
    warn: message => ctx.logger.warn(message),
  })
  // Registered last, so it runs innermost: it sees the bash result itself, and DSH's spill policy
  // (which prepends) bounds the projection rather than handing LightCode a spilled preview.
  ctx.on('tools/post-execute', async (exec, result, next) => economy.postExecute(exec, result, await next()))

  const shadow = createDshShadow({
    host: HOST, mode: session => economy.shadowMode(session), journal: economy.journal, artifacts: economy.artifacts, read: economy.read,
    warn: message => ctx.logger.warn(message),
  })
  // Presets mount their compaction engines after this plugin; look again whenever an agent starts or steps.
  const discover = () => { try { shadow.discover(ctx.events) } catch (error) { ctx.logger.warn(`LightCode LightShadow: ${String(error)}`) } }
  discover()
  ctx.on('agent/created', () => { discover(); return undefined }, { global: true })
  ctx.on('agent/pre-step', async (_payload, next) => { discover(); return next() }, { global: true, prepend: true })
  economy.extraReport = () => {
    const { engines, pruners } = shadow.attached
    return engines === 0 ? ['LightShadow: no DSH compaction engine found yet (it attaches when an agent starts).']
      : [`LightShadow is attached to ${engines} compaction engine${engines === 1 ? '' : 's'} and ${pruners} result pruner${pruners === 1 ? '' : 's'}.`]
  }
  ctx.tools?.register({
    name: RECALL_TOOL.name,
    description: RECALL_TOOL.description,
    parameters: {
      type: 'object',
      properties: {
        observation_id: { type: 'string', description: 'An observation_id from the observation catalog, such as o-1a2b3c4d5e6f.' },
        query: { type: 'string', description: 'An exact string the result contains; needed for results over 8 KB.' },
        original: { type: 'boolean', description: 'Read the complete output LightCode shortened before you first read it.' },
      },
      required: ['observation_id'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', properties: { text: { type: 'string' }, ok: { type: 'boolean' } }, required: ['text', 'ok'], additionalProperties: false },
      render: (_args, value) => [{ type: 'text', text: String((value as { text?: unknown }).text ?? '') }],
    },
    async execute(args, exec) {
      const session = exec.agent?.session
      if (!session) return { text: 'recall failed: no session', ok: false }
      const { text, result } = shadow.recall({ id: String(session.id) }, args, String(exec.callId))
      return { text, ok: result.ok }
    },
  })
  ctx.inject(['commands'], inner => {
    inner.effect(() => inner.commands.register({
      definitionId: '@lightcode/dsh/lightcode',
      name: 'lightcode',
      description: 'LightCode: tokens saved in this session and the current mode',
      handler: invocation => {
        const session = invocation.agent.session
        return { kind: 'success', text: economy.report({ id: String(session.id), cwd: session.header?.cwd }) }
      },
    }), 'lightcode: /lightcode command')
  })
}
