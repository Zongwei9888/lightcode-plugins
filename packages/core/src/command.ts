/**
 * Recognize literal argv, an optional quiet cd prefix, and the endings agents
 * add to test runs that leave the output as it is: `2>&1` (stderr into the
 * same output) and `| tee [-a] <file>` (a copy saved to a file). Unknown shell
 * syntax passes through.
 */
export function literalCommand(command: string): readonly string[] | undefined {
  if (/[\r\n\0]/.test(command)) return undefined
  command = command.replace(/\s*\|\s*tee(?:\s+-a)?\s+[\w./+-]+\s*$/u, '').replace(/\s+2>&1\s*$/u, '')
  const words: string[] = []
  const conjunctions: number[] = []
  let word = ''
  let started = false
  let quote: "'" | '"' | undefined
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]!
    if (quote !== undefined) {
      if (ch === quote) quote = undefined
      else {
        if (quote === '"' && /[$`\\]/.test(ch)) return undefined
        word += ch
      }
    } else if (ch === "'" || ch === '"') {
      quote = ch
      started = true
    } else if (/\s/.test(ch)) {
      if (started) words.push(word)
      word = ''
      started = false
    } else if (ch === '&' && command[i + 1] === '&') {
      if (started) words.push(word)
      conjunctions.push(words.length)
      words.push('&&')
      word = ''
      started = false
      i += 1
    } else if (/[;|&<>$`(){}\\#*?\[\]]/.test(ch) || (ch === '~' && !started)) return undefined
    else {
      word += ch
      started = true
    }
  }
  if (quote !== undefined) return undefined
  if (started) words.push(word)
  if (conjunctions.length === 1 && conjunctions[0] === 2 && words[0] === 'cd' && words[2] === '&&'
    && /^(?:\/|\.\.?\/)/.test(words[1] ?? '')) words.splice(0, 3)
  if (words.length === 0 || words.includes('&&') || words[0] === '') return undefined
  return words
}

/**
 * `literalCommand` with the program named by its file name, so
 * `/opt/homebrew/bin/python3 -m pytest` and `.venv/bin/pytest` read as the
 * tools they run. For the built-in filters, which also check the output's
 * shape; learned rules see the command as written.
 */
export function toolArgv(command: string): readonly string[] | undefined {
  const argv = literalCommand(command)
  const head = argv?.[0]
  if (!argv || !head?.includes('/')) return argv
  const name = head.slice(head.lastIndexOf('/') + 1)
  return name ? [name, ...argv.slice(1)] : undefined
}

/** Unsupported compounds are never reduced to their final segment. */
export function lastEffectiveCommand(command: string): string {
  return literalCommand(command)?.join(' ') ?? ''
}

/** Only transparent, literal package runners; never infer a package script's body. */
export function developerCommand(command: string): readonly string[] | undefined {
  const argv = toolArgv(command)
  if (argv === undefined) return undefined
  if (argv[0] === 'npx') return argv[1]?.startsWith('-') ? undefined : argv.slice(1)
  if (argv[0] === 'pnpm') {
    if (argv[1] === 'exec') return argv[2]?.startsWith('-') ? undefined : argv.slice(2)
    // `pnpm tsc` can resolve to a package script, so only accept explicit exec.
    return argv
  }
  return argv
}

/** Literal test-script invocation, not node -e/-r or an arbitrary program. */
export function isCustomNodeTestCommand(argv: readonly string[]): boolean {
  if (argv[0] !== 'node' || argv.length !== 2) return false
  const path = argv[1]!
  return /\.[cm]?js$/.test(path) && !path.startsWith('-')
    && (/(?:^|\/)tests?\//.test(path) || /(?:^|\/)(?:run-tests|test)\.[cm]?js$/.test(path) || /\.test\.[cm]?js$/.test(path))
}

/** Closed package-test calls; forwarding/watch/workspace flags need their own protocol. */
export function isPackageTestCommand(argv: readonly string[]): boolean {
  if (!['npm', 'pnpm', 'yarn', 'bun'].includes(argv[0] ?? '')) return false
  const offset = argv[1] === 'test' ? 2 : argv[1] === 'run' && argv[2] === 'test' ? 3 : 0
  if (!offset) return false
  return argv.slice(offset).every(arg => arg === '--silent'
    || argv[0] === 'npm' && /^--logs-max=\d+$/.test(arg))
}
