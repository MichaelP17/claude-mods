import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { pruneTranscript } from './compact'
import type { Settings } from './compact'
import { MAX_STATE_TOKENS, buildState, estimateTokens, redact } from './jev'
import type { Asker } from './jev'
import { applyDrops, charsOf, collectCalls, shrinkWriteInput, supersededReads } from './prune'

const SETTINGS: Settings = {
  keepThreshold: 0.5,
  aggressiveThreshold: 0.75,
  preserveRecentMessages: 2,
  targetTokens: 1000,
  previewChars: 300,
  keepHeadChars: 300,
}

function call(id: string, tool: string, input: Record<string, unknown>, output: string): SessionMessage[] {
  return [
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: id, tool, input, text: output }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: id, text: output, isError: false }] },
  ]
}

function transcript(): SessionMessage[] {
  return [
    { role: 'user', text: 'Fix the parser bug in src/parser.ts', toolUses: [], handle: 'h0' },
    ...call('a', 'Read', { file_path: 'src/parser.ts' }, 'x'.repeat(6000)),
    ...call('b', 'Bash', { command: 'npm test' }, 'y'.repeat(9000)),
    ...call('c', 'Edit', { file_path: 'src/parser.ts', old_string: 'o'.repeat(2000), new_string: 'n'.repeat(2000) }, 'ok'),
    ...call('d', 'Grep', { pattern: 'parse' }, 'z'.repeat(5000)),
    { role: 'assistant', text: 'The bug is fixed, tests pass.', toolUses: [], handle: 'h9' },
    { role: 'user', text: 'Great, commit it.', toolUses: [], handle: 'h10' },
  ]
}

function fixedAsker(probabilities: Record<string, number>): { ask: Asker; questions: string[] } {
  const questions: string[] = []
  const ask: Asker = async (_state, asked) => {
    questions.push(...Object.keys(asked))

    return {
      answers: new Map(Object.keys(asked).map(i => [i, probabilities[i.replace(/^keep_/, '')] ?? 0.9])),
      inputTokens: 1200,
      costUsd: null,
    }
  }

  return { ask, questions }
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

test('without Jev only the rules cut', async () => {
  const outcome = await pruneTranscript(transcript(), 8000, SETTINGS, null)
  expect(outcome.stage).toBe('rules')
  expect(outcome.decisions.find(i => i.id === 't1')?.reason).toBe('superseded')
  expect(outcome.decisions.find(i => i.id === 't2')?.reason).toBe('kept')
  expect(outcome.tokensAfter).toBeLessThan(8000)
})

test('Jev decides the rest; the aggressive threshold runs only when the target is missed', async () => {
  const { ask, questions } = fixedAsker({ t2: 0.2, t4: 0.6 })
  const outcome = await pruneTranscript(transcript(), 8000, SETTINGS, ask)
  expect(questions.sort()).toEqual(['keep_t2', 'keep_t4'])
  expect(outcome.stage).toBe('jev-aggressive')
  expect(outcome.decisions.find(i => i.id === 't2')?.reason).toBe('cut')
  expect(outcome.decisions.find(i => i.id === 't4')?.reason).toBe('cut')
  expect(outcome.jevRequests).toBe(1)

  const relaxed = await pruneTranscript(transcript(), 8000, { ...SETTINGS, targetTokens: 5000 }, ask)
  expect(relaxed.stage).toBe('jev')
  expect(relaxed.decisions.find(i => i.id === 't4')?.reason).toBe('kept')
})

test('a failing Jev leaves the rules standing and reports the error', async () => {
  const failing: Asker = async () => {
    throw new Error('Jev answered 500')
  }
  const outcome = await pruneTranscript(transcript(), 8000, SETTINGS, failing)
  expect(outcome.stage).toBe('rules')
  expect(outcome.jevError).toBe('Jev answered 500')
})

test('secrets are redacted before anything is sent', () => {
  expect(redact('API_KEY=abc123 and token: "xyz"')).toBe('API_KEY=[redacted] and token: [redacted]')
  expect(redact('key sk-ant-abcdefghijklmnopqrstuvwxyz')).toBe('key [redacted]')
})

test('a large conversation is shrunk until Jev can read it', () => {
  const messages: SessionMessage[] = [{ role: 'user', text: 'start', toolUses: [] }]
  for (let i = 0; i < 400; i += 1) {
    messages.push({ role: 'assistant', text: 'step '.repeat(200), toolUses: [] })
    messages.push(...call(`c${i}`, 'Bash', { command: `run ${i} ${'arg '.repeat(100)}` }, 'out'.repeat(2000)))
  }
  messages.push({ role: 'user', text: 'done?', toolUses: [] })
  const calls = collectCalls(messages, 2)
  const { state, tokens } = buildState(messages, calls, new Set(calls.map(i => i.id)), new Set(), 300, 2)
  expect(tokens).toBeLessThanOrEqual(MAX_STATE_TOKENS)
  expect(estimateTokens(JSON.stringify(state))).toBe(tokens)
})
