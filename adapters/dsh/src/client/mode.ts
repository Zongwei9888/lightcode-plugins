/** The `mode` field: pure, so it is testable without the Web client's modules. */
import type { SettingsFieldSpec } from '@deepseek-ai/dsh-client-ui-primitives'

export const MODES = ['apply', 'observe', 'off'] as const
export type Mode = typeof MODES[number]
export const isMode = (value: unknown): value is Mode => typeof value === 'string' && (MODES as readonly string[]).includes(value)

/** `mode` as the staged form sees it: the effective value as text; an empty draft re-inherits. */
export const MODE_FIELD: SettingsFieldSpec = {
  field: 'mode',
  format: value => isMode(value) ? value : '',
  parse: text => text === '' ? { kind: 'clear' } : isMode(text) ? { kind: 'set', value: text } : undefined,
}
