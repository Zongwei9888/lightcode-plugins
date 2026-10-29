/**
 * The OpenCode plugin module. OpenCode starts every function a plugin module
 * exports, so this module exports the plugin and nothing else.
 */
import { createLightCode } from './plugin.ts'

export const LightCode = createLightCode()
