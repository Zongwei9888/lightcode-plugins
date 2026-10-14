// The plugins' bundled evolve.js, run from source.
import { runnerMain } from '../../src/index.ts'

process.exitCode = await runnerMain(process.argv.slice(2))
