/**
 * LightCode for DeepSeek Harness 0.2.x, Host half. Recognized `bash` output is
 * replaced by a deterministic projection in the `tools/post-execute`
 * waterfall, so the model and the session log receive the smaller text while
 * LightCode keeps the original (and a source map) in its private store.
 * `/lightcode` reports the savings; the `mode` setting is live.
 */
import Schema from '@deepseek-ai/schemastery'
import type { MechanismMode } from '@lightcode/protocol'
import { INLINE_LIMIT_CHARS, createDshEconomy } from './economy.ts'
import type { HostContext, Volatile } from './host.ts'

export const name = 'lightcode'
export const inject = ['tools']

export interface Config {
  mode: Volatile<MechanismMode>
  inlineLimitChars: number
}

export const Config = Schema.object({
  mode: Schema.union(['apply', 'observe', 'off']).default('apply')
    .description('apply: the model reads the smaller projection; observe: record what would change, deliver the original; off: do nothing.')
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
