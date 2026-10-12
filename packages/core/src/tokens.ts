/**
 * Default token estimate: the fixed four-characters-per-token density used by
 * DeepSeek Harness and most agent hosts for text. Adapters pass the host's own
 * meter when one exists; admission compares raw and projected text with the
 * same estimator, so only the relative size matters.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export type TokenEstimator = (text: string) => number
