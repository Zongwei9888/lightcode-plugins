/**
 * The OpenCode plugin module. OpenCode starts every function a plugin module
 * exports, so this module exports the plugin and nothing else.
 */
import { createTokenWise } from './plugin.ts'

export const TokenWise = createTokenWise()
