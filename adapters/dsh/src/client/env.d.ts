/**
 * The browser modules the DSH Web client hands this plugin's factory. They are
 * resolved from the page's module table at load time (never bundled), so only
 * the members used here are declared, after
 * `@deepseek-ai/dsh-client-ui-primitives` 0.2.0-rc.2 / 0.2.1-alpha.2.
 */
declare module 'react/jsx-runtime' {
  export function jsx(type: unknown, props: Record<string, unknown>, key?: string): unknown
  export function jsxs(type: unknown, props: Record<string, unknown>, key?: string): unknown
}

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  export interface SettingsFieldWrite { kind: 'set'; value: unknown }
  export type SettingsFieldParse = SettingsFieldWrite | { kind: 'clear' } | undefined
  export interface SettingsFieldSpec { field: string; format: (value: unknown) => string; parse: (text: string) => SettingsFieldParse }
  export interface SettingsFormShell { available: boolean; writable: boolean; dirty: boolean; invalid: boolean; saving: boolean; failed: boolean }
  export interface SettingsFieldState { text: string; overridden: boolean; invalid: boolean }
  export interface SettingsFormActions { edit(field: string, text: string): void; resetField(field: string): void; save(): void; discard(): void }
  export interface SnapshotStore<S> { getSnapshot(): S; subscribe(listener: () => void): () => void }
  export class SettingsFormModel<T> {
    constructor(scope: unknown, specs: SettingsFieldSpec[])
    bind<S>(project: () => S): SnapshotStore<S>
    shell(): SettingsFormShell
    field(field: string): SettingsFieldState
    actions(): SettingsFormActions
    dispose(): void
    readonly __config?: T
  }
  export const SettingsForm: unknown
  export const SegmentedControl: unknown
  export const Tag: unknown
}
