/**
 * The learning runner the extension starts as its own process (bundled as
 * dist/evolve.js): a learning run, the evidence scan, and the learner's
 * ./check and ./try.
 */
import { runnerMain } from '@lightcode-ai/mechanisms'

process.exitCode = await runnerMain(process.argv.slice(2))
