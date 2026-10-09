import { expect, test } from 'claude-code/testing'

import { hasConfigChanges } from './status'

test('a clean config reports no changes, whatever is not covered', async () => {
  expect(hasConfigChanges('No config changes since the last commit.')).toBe(false)
  expect(hasConfigChanges('No config changes since the last commit.\n\nNot covered by snapshots (decide whether to allowlist in ~/.claude/.gitignore):\n  newtool')).toBe(false)
})

test('changed config files count', async () => {
  expect(hasConfigChanges(' M settings.json')).toBe(true)
  expect(hasConfigChanges('?? ideas/\n M CLAUDE.md')).toBe(true)
})

test('changes under ideas/ alone stay quiet', async () => {
  expect(hasConfigChanges('?? ideas/')).toBe(false)
  expect(hasConfigChanges(' M ideas/home/Projects/app.md\n D ideas/home.md\n?? "ideas/home/caf\\303\\251.md"')).toBe(false)
})

test('a failed status run still raises the toast', async () => {
  expect(hasConfigChanges('Failed (exit 1):\nfatal: not a git repository')).toBe(true)
})
