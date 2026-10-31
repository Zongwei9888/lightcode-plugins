/** Scripted process outputs, not measurements of live tasks or API savings. */
export const codingOutputCases = [
  {
    filter: 'test-report', command: 'cargo test', exitCode: 101,
    stdout: 'running 81 tests\n' + Array.from({ length: 80 }, (_, i) => `test tests::case_${i} ... ok\n`).join('')
      + 'test tests::failure ... FAILED\nfailures:\n    assertion failed: important evidence\ntest result: FAILED. 80 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s\n',
    required: 'assertion failed: important evidence',
  },
  {
    filter: 'cargo-build', command: 'cargo build', exitCode: 101,
    stdout: Array.from({ length: 80 }, (_, i) => `   Compiling dep${i} v1.0.0\n`).join('')
      + 'error[E0308]: mismatched types\n --> src/lib.rs:3:5\n  | expected u32, found String\nerror: could not compile fixture due to previous error\n',
    required: 'expected u32, found String',
  },
  {
    filter: 'search-layout', command: 'echo matches && grep -rn value src | head -100', exitCode: 0,
    stdout: '=== matches ===\n' + Array.from({ length: 80 }, (_, i) => `src/long-directory/important-file.ts:${i + 1}: value ${i}\n`).join('') + 'unrelated output remains\n',
    required: '80: value 79',
  },
  {
    filter: 'path-list', command: 'find src -type f | sort', exitCode: 0,
    stdout: Array.from({ length: 80 }, (_, i) => `src/long-directory/other-directory/file-${i}.ts\n`).join(''),
    required: 'file-79.ts',
  },
  {
    filter: 'ls-listing', command: 'pwd && ls -la', exitCode: 0,
    stdout: '/project\ntotal 80\n' + Array.from({ length: 80 }, (_, i) => `-rw-r--r--  1 user staff 1234 Sep  8 12:00 file-${i}.ts\n`).join(''),
    required: 'file-79.ts',
  },
  {
    filter: 'test-progress', command: 'npm test 2>&1 | tail -100', exitCode: 0,
    stdout: Array.from({ length: 80 }, (_, i) => `  ✓ positive-status test ${i}\n`).join('') + '80 passed, 0 failed\nwarning: preserve the diagnostic\n',
    required: 'preserve the diagnostic',
  },
  {
    filter: 'ruff-json', command: 'ruff check --output-format=json src/', exitCode: 1,
    stdout: JSON.stringify(Array.from({ length: 8 }, (_, i) => ({
      filename: `/repo/src/file${i}.py`, code: 'F401', message: 'unused import remains visible',
      location: { row: 1, column: 1 }, end_location: { row: 1, column: 10 },
      fix: { edits: [{ content: '', location: { row: 1, column: 1 } }] }, future: { keep: true },
    })), null, 4),
    required: 'unused import remains visible',
  },
  {
    filter: 'go-test-json', command: 'go test -json ./...', exitCode: 1,
    stdout: Array.from({ length: 40 }, (_, i) => `{     "Action": "output",     "Package": "example/p",     "Test": "Test${i}",     "Output": "diagnostic remains visible\\n"     }\n`).join('')
      + '{ "Action": "fail", "Package": "example/p", "Elapsed": 1.5 }\n',
    required: 'diagnostic remains visible',
  },
  {
    filter: 'git-status', command: 'git status', exitCode: 0,
    // Recovery locators can cost more than four removed hints. Keeping raw is correct then.
    mayKeepOriginal: true,
    stdout: 'On branch main\nChanges to be committed:\n'
      + '  (use "git restore --staged <file>..." to unstage)\n\tmodified:   staged.ts\n\n'
      + 'Changes not staged for commit:\n'
      + '  (use "git add <file>..." to update what will be committed)\n'
      + '  (use "git restore <file>..." to discard changes in working directory)\n\tmodified:   unstaged.ts\n\n'
      + 'Untracked files:\n  (use "git add <file>..." to include in what will be committed)\n\tnew.ts\n',
    required: 'unstaged.ts',
  },
  {
    filter: 'tsc', command: 'pnpm exec tsc --noEmit --pretty false', exitCode: 2,
    stdout: ('src/甲.ts(12,3): error TS2322: Type "string" is not assignable to type "number".\r\n' +
      '  Types of property "value" are incompatible.\r\n').repeat(30) +
      'src/other.ts(2,1): error TS2304: Cannot find name "missing".\r\n',
    required: 'Cannot find name "missing".',
  },
  {
    filter: 'eslint-json', command: 'eslint -f json src/', exitCode: 1,
    stdout: JSON.stringify(Array.from({ length: 8 }, (_, i) => ({
      filePath: `/repo/src/甲${i}.ts`,
      messages: [{ ruleId: 'no-unused-vars', severity: 2, message: 'Unused "value" 😀', line: 3, column: 1,
        suggestions: [{ desc: 'Preserve suggestions', fix: { range: [10, 15], text: 'a  b' } }] }],
      errorCount: 1, warningCount: 0, fixableErrorCount: 0, fixableWarningCount: 0,
      source: 'const x = "a  b";\n', futureField: { keep: true },
    })), null, 4),
    required: 'Preserve suggestions',
  },
  {
    filter: 'vite-build', command: 'pnpm exec vite build', exitCode: 0,
    stdout: 'vite v6.1.0 building for production...\ntransforming...\n✓ 250 modules transformed.\n' +
      'rendering chunks...\ncomputing gzip size...\n' +
      Array.from({ length: 40 }, (_, i) => `dist/assets/chunk${i}.js                         12.34 kB │ gzip:  4.56 kB\n`).join('') +
      'WARNING: circular dependency\n✓ built in 1.20s\n',
    required: 'WARNING: circular dependency',
  },
  {
    filter: 'pnpm-install', command: 'pnpm install --frozen-lockfile', exitCode: 0,
    stdout: Array.from({ length: 40 }, (_, i) => `Progress: resolved ${i + 1}, reused 0, downloaded ${i + 1}, added ${i + 1}\n`).join('') +
      'Progress: resolved 40, reused 0, downloaded 40, added 40, done\n' +
      'WARN deprecated dependency@1.0.0\nPackages: +40\nDone in 2.1s using pnpm v10.0.0\n',
    required: 'WARN deprecated dependency@1.0.0',
  },
] as const
