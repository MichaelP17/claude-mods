import { expect, test } from 'claude-code/testing'

import { formatSpan, modelName, parseGitStatus, shortenPath } from './format'

test('model ids and display names read like the terminal status line', async () => {
  expect(modelName('claude-opus-5-5[1m]')).toBe('Opus 5.5')
  expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(modelName('claude-fable-5-1')).toBe('Fable 5.1')
  expect(modelName('Opus 5.5 (1M Context)')).toBe('Opus 5.5')
})

test('git porcelain v2 becomes branch and marks', async () => {
  const state = parseGitStatus(
    [
      '# branch.oid 1234567890abcdef',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 abc abc file.ts',
      '? notes.md',
      '',
    ].join('\n'),
  )
  expect(state).toEqual({ branch: 'main', worktree: null, changed: 1, untracked: 1, ahead: 2, behind: 1 })
  expect(parseGitStatus('# branch.oid 1234567890abcdef\n# branch.head (detached)\n')?.branch).toBe('1234567')
  expect(parseGitStatus('')).toBeNull()
})

test('paths and durations are shortened', async () => {
  expect(shortenPath('/Users/test/Projects/x', '/Users/test')).toBe('~/Projects/x')
  expect(shortenPath('/Users/tester', '/Users/test')).toBe('/Users/tester')
  expect(formatSpan(42_000)).toBe('42s')
  expect(formatSpan(5 * 60_000)).toBe('5m')
  expect(formatSpan(2 * 3_600_000 + 7 * 60_000)).toBe('2h07')
})
