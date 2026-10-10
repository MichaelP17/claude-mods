import { expect, test } from 'claude-code/testing'

import {
  channelOf,
  folderNameOf,
  formatChars,
  formatDuration,
  forwardTextOf,
  newId,
  parseCommand,
  previewOf,
  promptBlocksOf,
  footerOf,
  statusOf,
} from './relay'

const LONG = 'Fix the countdown. '.repeat(20).trim()

test('untagged and text blocks long enough count as prompts, code blocks never', () => {
  const answer = [
    'Here is the prompt:',
    '',
    '```',
    LONG,
    '```',
    '',
    '```bash',
    `echo "${LONG}"`,
    '```',
    '',
    '```text',
    'too short',
    '```',
  ].join('\n')

  expect(promptBlocksOf(answer, 100)).toEqual([LONG])
  expect(promptBlocksOf(answer, 5)).toEqual([LONG, 'too short'])
})

test('a longer outer fence keeps an inner code block inside the prompt', () => {
  const inner = ['Run this first:', '', '```bash', 'node engine/render.mjs', '```', '', LONG].join('\n')
  const answer = ['````markdown', inner, '````'].join('\n')

  expect(promptBlocksOf(answer, 100)).toEqual([inner])
})

test('a fence indented in a list is read without its indentation, an unclosed one not at all', () => {
  const answer = ['1. For the new session:', '', '   ```', `   ${LONG}`, '   second line', '   ```', '', '```', 'never closed'].join('\n')

  expect(promptBlocksOf(answer, 100)).toEqual([`${LONG}\nsecond line`])
})

test('channel names are folded to lowercase and dashes, anything else is refused', () => {
  expect(channelOf('Clued')).toBe('clued')
  expect(channelOf('  motion studio ')).toBe('motion-studio')
  expect(channelOf('a/b')).toBeNull()
  expect(channelOf('')).toBeNull()
  expect(folderNameOf('/Users/test/Projects/Clued/')).toBe('Clued')
})

test('the command line reads lead, worker, send and off', () => {
  expect(parseCommand('')).toEqual({ kind: 'open' })
  expect(parseCommand('lead Clued')).toEqual({ kind: 'join', role: 'lead', channel: 'clued' })
  expect(parseCommand('worker')).toEqual({ kind: 'join', role: 'worker', channel: null })
  expect(parseCommand('send Line one\nline two')).toEqual({ kind: 'send', text: 'Line one\nline two' })
  expect(parseCommand('OFF')).toEqual({ kind: 'off' })
  expect(parseCommand('lead a/b').kind).toBe('invalid')
  expect(parseCommand('pair').kind).toBe('invalid')
})

test('previews take the first line of content without Markdown marks', () => {
  expect(previewOf('\n## **Feedback** on the clip\nmore')).toBe('Feedback on the clip')
  expect(previewOf('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`)
})

test('sizes and durations read short', () => {
  expect(formatChars(999)).toBe('999 chars')
  expect(formatChars(3456)).toBe('3.5k chars')
  expect(formatDuration(42_000)).toBe('42s')
  expect(formatDuration(12 * 60_000)).toBe('12m')
  expect(formatDuration(125 * 60_000)).toBe('2h 05m')
})

test('forwarded answers say where they come from, oldest first', () => {
  const one = forwardTextOf('clued', [{ id: 'a', text: 'Rendered.', finishedAt: 1 }])
  expect(one).toBe('The latest answer from the Claude session working on "clued", relayed unchanged:\n\nRendered.')

  const two = forwardTextOf('clued', [
    { id: 'a', text: 'Rendered.', finishedAt: 1 },
    { id: 'b', text: 'Handoff written.', finishedAt: 2 },
  ])
  expect(two).toContain('The latest 2 answers')
  expect(two.indexOf('Rendered.')).toBeLessThan(two.indexOf('Handoff written.'))
})

test('the lead status shows whether the worker works, and what waits', () => {
  const link = { role: 'lead', channel: 'clued' } as const
  const base = { link, answers: [], tasks: [], isAttached: false, isActive: false, now: 1_000_000 }

  expect(statusOf({ ...base, presence: null })).toBe('⇄ clued · no worker open')
  expect(statusOf({ ...base, presence: { sessionId: 's', busySince: 1_000_000 - 720_000, seenAt: 999_000 } })).toBe(
    '⇄ clued · working 12m',
  )
  expect(
    statusOf({
      ...base,
      presence: { sessionId: 's', busySince: null, seenAt: 999_000 },
      answers: [{ id: 'a', text: 'x', finishedAt: 1 }],
      isAttached: true,
    }),
  ).toBe('⇄ clued · 1 answer attached')
})

test('the worker status says when another session holds the slot', () => {
  const link = { role: 'worker', channel: 'clued' } as const
  const task = { id: 't', text: 'x', isFresh: false, sentAt: 1 }
  const base = { link, presence: null, answers: [], isAttached: false, now: 0 }

  expect(statusOf({ ...base, tasks: [task], isActive: true })).toBe('⇄ clued · worker · task waiting')
  expect(statusOf({ ...base, tasks: [task], isActive: false })).toBe('⇄ clued · worker · another session is the worker')
})

test('the footer says the same in a few cells', () => {
  const lead = { role: 'lead', channel: 'clued' } as const
  const leadBase = { link: lead, answers: [], tasks: [], isAttached: false, isActive: false, now: 1_000_000 }
  const answer = { id: 'a', text: 'x', finishedAt: 1 }

  expect(footerOf({ ...leadBase, presence: null })).toBe('⇄ clued offline')
  expect(footerOf({ ...leadBase, presence: { sessionId: 's', busySince: 1_000_000 - 720_000, seenAt: 999_000 } })).toBe('⇄ clued ⚙ 12m')
  expect(footerOf({ ...leadBase, presence: { sessionId: 's', busySince: null, seenAt: 999_000 }, answers: [answer, answer] })).toBe('⇄ clued 📨 2')
  expect(footerOf({ ...leadBase, presence: null, answers: [answer], isAttached: true })).toBe('⇄ clued offline 📎 1')

  const worker = { role: 'worker', channel: 'clued' } as const
  const task = { id: 't', text: 'x', isFresh: false, sentAt: 1 }
  const workerBase = { link: worker, presence: null, answers: [], isAttached: false, now: 0 }

  expect(footerOf({ ...workerBase, tasks: [], isActive: true })).toBe('⇄ clued worker')
  expect(footerOf({ ...workerBase, tasks: [task], isActive: true })).toBe('⇄ clued worker 📥')
  expect(footerOf({ ...workerBase, tasks: [task], isActive: false })).toBe('⇄ clued worker ⏸')
})

test('ids sort by time', () => {
  expect(newId(5, 0.5) < newId(40, 0)).toBe(true)
})
