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
  const literal = literalCommand(command)
  if (!literal) return undefined
  const argv = withoutRunners(literal)
  const head = argv[0]
  if (!head?.includes('/')) return argv
  const name = head.slice(head.lastIndexOf('/') + 1)
  return name ? [name, ...argv.slice(1)] : undefined
}

/** Runners that start the program after them in the project's environment, and the word that says so. */
const RUNNERS: Readonly<Record<string, string>> = { uv: 'run', poetry: 'run', pipenv: 'run', pdm: 'run', rye: 'run', hatch: 'run', bundle: 'exec' }

/**
 * The program a runner prefix starts: `uv run pytest`, `poetry run pytest`,
 * `bundle exec rspec`, `time pytest`, `CI=1 pytest`. Only a runner directly
 * followed by the program; a runner option (`uv run --with x pytest`) leaves
 * the command as it is.
 */
function withoutRunners(argv: readonly string[]): readonly string[] {
  let rest = argv
  for (let peeled = 0; peeled < 4; peeled++) {
    let start = 0
    while (start < rest.length - 1 && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(rest[start]!)) start++
    const next = start > 0 ? rest.slice(start) : rest
    const word = RUNNERS[next[0] ?? '']
    if (word !== undefined && next[1] === word && next.length > 2 && !next[2]!.startsWith('-')) rest = next.slice(2)
    else if (next[0] === 'time' && next.length > 1 && !next[1]!.startsWith('-')) rest = next.slice(1)
    else return next
  }
  return rest
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

/** Programs whose output is the content of the files they read. */
const FILE_READERS = new Set(['cat', 'tac', 'nl', 'head', 'tail', 'less', 'more', 'bat', 'batcat', 'sed', 'xxd', 'od', 'hexdump', 'strings', 'jq', 'yq'])
/** Words that run the program after them. */
const WRAPPERS = new Set(['sudo', 'env', 'command', 'time', 'nice', 'nohup', 'xargs', 'exec', '-exec', '-execdir'])

/**
 * Whether any program in the command prints file contents (`cat`, `head`,
 * `sed -n`, ...), not counting one that reads a pipe. The agent reads a file to see what is in it, so learned
 * rules leave such output alone; built-in filters are unaffected.
 */
export function readsFileContent(command: string): boolean {
  const program = (word: string) => word.replace(/^["']|["']$/gu, '').replace(/^.*\//u, '')
  const parts = command.split(/(\|\|?|&&|;|\$\(|`|\n)/u)
  for (let p = 0; p < parts.length; p += 2) {
    // After a pipe, head, tail or sed trim another command's output; they read no file.
    if (parts[p - 1] === '|') continue
    const words = parts[p]!.trim().split(/\s+/u)
    // Skip VAR=value assignments; the first other word runs, and so does any word after a wrapper.
    let first = 0
    while (first < words.length - 1 && /^[A-Za-z_]\w*=/u.test(words[first]!)) first++
    if (words.some((word, i) => (i === first || i > 0 && WRAPPERS.has(words[i - 1]!)) && FILE_READERS.has(program(word)))) return true
  }
  return false
}
