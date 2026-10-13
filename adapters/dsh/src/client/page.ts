/** The `mode` form on LightCode's bundle page in Plugins. */
import { jsx, jsxs } from 'react/jsx-runtime'
import { SegmentedControl, SettingsForm, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsFieldState, SettingsFormActions, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Copy } from './locales.ts'
import { MODES, isMode } from './mode.ts'
import type { Mode } from './mode.ts'


export interface ConfigState extends SettingsFormShell { mode: SettingsFieldState }

interface Props extends SettingsFormActions {
  readonly t: (key: keyof Copy) => string
  readonly view: 'page' | 'summary'
  readonly useLightcodeConfig: <S>(select: (state: ConfigState) => S) => S
}

const text = { margin: 0, fontSize: '12.5px', lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }

/** The bundle page's form, or its one-liner when the page asks for a summary. */
export function LightCodeConfig(props: Props): unknown {
  const { t } = props
  const state = props.useLightcodeConfig(snapshot => snapshot)
  if (props.view === 'summary') return t('summary')
  const mode: Mode = isMode(state.mode.text) ? state.mode.text : 'apply'
  const locked = !state.writable || state.saving
  return jsxs(SettingsForm, {
    labels: { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') },
    state,
    onSave: props.save,
    onDiscard: props.discard,
    children: [
      jsxs('div', {
        'data-lightcode-mode': mode,
        style: { display: 'flex', flexDirection: 'column', gap: '8px' },
        children: [
          jsxs('div', {
            style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' },
            children: [
              jsx('span', { style: { fontSize: '13px', fontWeight: 500, lineHeight: '20px', color: 'var(--dsw-alias-label-primary)' }, children: t('mode') }),
              state.mode.overridden ? jsxs('span', {
                style: { display: 'inline-flex', alignItems: 'center', gap: '8px' },
                children: [
                  jsx(Tag, { tone: 'neutral', children: t('overridden') }),
                  jsx('button', {
                    type: 'button', disabled: locked, onClick: () => props.resetField('mode'),
                    style: { background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit', fontSize: '12.5px', color: 'var(--dsw-alias-label-secondary)' },
                    children: t('reset'),
                  }),
                ],
              }) : null,
            ],
          }),
          jsx(SegmentedControl, {
            id: 'lightcode-mode', value: mode, label: t('modeLabel'), disabled: locked,
            options: MODES.map(value => ({ value, label: t(value) })),
            onChange: (next: Mode) => props.edit('mode', next),
          }),
          jsx('p', { id: `lightcode-mode-${mode}-panel`, role: 'tabpanel', 'aria-labelledby': `lightcode-mode-${mode}`, style: text, children: t(`${mode}Hint`) }),
        ],
      }),
      jsx('p', { style: text, children: t('savings') }),
    ],
  })
}
