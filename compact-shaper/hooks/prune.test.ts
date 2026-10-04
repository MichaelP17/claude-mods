import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { applyDrops, charsOf, collectCalls, pruneTranscript, shrinkWriteInput, supersededReads } from './prune'

function call(id: string, tool: string, input: Record<string, unknown>, output: string, isError = false): SessionMessage[] {
  return [
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: id, tool, input, text: output }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: id, text: output, isError }] },
  ]
}

function transcript(): SessionMessage[] {
  return [
    { role: 'user', text: 'Fix the parser bug in src/parser.ts', toolUses: [], handle: 'h0' },
    ...call('a', 'Read', { file_path: 'src/parser.ts' }, 'x'.repeat(6000)),
    ...call('b', 'Bash', { command: 'npm test' }, 'y'.repeat(9000)),
    ...call('c', 'Edit', { file_path: 'src/parser.ts', old_string: 'o'.repeat(2000), new_string: 'n'.repeat(2000) }, 'ok'),
    ...call('d', 'Grep', { pattern: 'parse' }, 'z'.repeat(5000)),
    ...call('e', 'Agent', { description: 'Map the parser' }, 'a'.repeat(3000)),
    ...call('f', 'Bash', { command: 'git status --short' }, 'g'.repeat(3000)),
    ...call('g', 'Bash', { command: 'dotnet test' }, 'f'.repeat(3000), true),
    { role: 'assistant', text: 'The bug is fixed, tests pass.', toolUses: [], handle: 'h9' },
    { role: 'user', text: 'Great, commit it.', toolUses: [], handle: 'h10' },
  ]
}

test('a read is superseded by a later edit of the same file', () => {
  const calls = collectCalls(transcript(), 2)
  expect([...supersededReads(calls)]).toEqual(['t1'])
})

test('a partial read does not supersede an earlier full read', () => {
  const messages = [
    { role: 'user' as const, text: 'go', toolUses: [] },
    ...call('a', 'Read', { file_path: 'a.ts' }, 'x'.repeat(2000)),
    ...call('b', 'Read', { file_path: 'a.ts', offset: 10, limit: 5 }, 'x'.repeat(100)),
    { role: 'user' as const, text: 'next', toolUses: [] },
    { role: 'assistant' as const, text: 'ok', toolUses: [] },
  ]
  expect(supersededReads(collectCalls(messages, 2)).size).toBe(0)
})

test('edit inputs shrink to their head, other tools stay untouched', () => {
  const shrunk = shrinkWriteInput('Edit', { file_path: 'a.ts', new_string: 'n'.repeat(2000) }, 300)
  expect(String(shrunk?.new_string).length).toBeLessThan(500)
  expect(shrunk?.file_path).toBe('a.ts')
  expect(shrinkWriteInput('Bash', { command: 'c'.repeat(2000) }, 300)).toBe(null)
})

test('untouched messages keep their handle, cut results keep a head and a note', () => {
  const messages = transcript()
  const calls = collectCalls(messages, 2)
  const result = applyDrops(messages, calls, new Set(['t2']), 300)
  expect(result[0]).toBe(messages[0])
  expect(result[result.length - 1]).toBe(messages[messages.length - 1])
  const cut = result[4]?.toolResults?.[0]?.text ?? ''
  expect(cut.startsWith('y'.repeat(300))).toBe(true)
  expect(cut).toContain('run Bash again')
  expect(charsOf(result)).toBeLessThan(charsOf(messages))
})

test('long re-readable outputs are cut, agents, errors and state snapshots stay', () => {
  const outcome = pruneTranscript(transcript(), 10_000, 2, 300)
  const reasons = Object.fromEntries(outcome.decisions.map(i => [i.id, i.reason]))
  expect(reasons).toEqual({
    t1: 'superseded',
    t2: 'cut',
    t3: 'short',
    t4: 'cut',
    t5: 'protected',
    t6: 'protected',
    t7: 'protected',
  })
  expect(outcome.tokensAfter).toBeLessThan(outcome.tokensBefore)
})

test('the newest messages are never cut', () => {
  const outcome = pruneTranscript(transcript(), 10_000, 30, 300)
  expect(outcome.decisions.filter(i => i.reason === 'cut')).toEqual([])
})
