import type { On, SessionCompactInput, SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { HANDOFF_INSTRUCTIONS } from './register'

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

function bigTranscript(): SessionMessage[] {
  return [
    { role: 'user', text: 'start', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Bash', input: { command: 'cat big.ts' } }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: 'x'.repeat(20_000), isError: false }] },
    ...Array.from({ length: 6 }, (_, index): SessionMessage => ({
      role: index % 2 === 0 ? 'assistant' : 'user',
      text: `turn ${index}`,
      toolUses: [],
    })),
  ]
}

function fakeEngine(on: On, compactions: SessionCompactInput[], toasts: string[]) {
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 8000, window: 1_000_000, percent: 1 }, rateLimits: [] } }))
  on('session.messages', () => ({ value: bigTranscript() }))
  on('session.compact', (_$, e) => {
    compactions.push(e)

    return { messages: [{ role: 'assistant' as const, text: 'summary', toolUses: [] }] }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
}

test('a compaction is summarized as a handoff, keeping the instructions typed after /compact', async ($, on) => {
  const compactions: SessionCompactInput[] = []
  fakeEngine(on, compactions, [])

  await $.session.compact({ trigger: 'auto', messages: bigTranscript() })
  await $.session.compact({ trigger: 'manual', messages: bigTranscript(), instructions: 'Keep the test failures.' })
  expect(compactions[0]?.instructions).toBe(HANDOFF_INSTRUCTIONS)
  expect(compactions[1]?.instructions).toBe(`${HANDOFF_INSTRUCTIONS}\n\nKeep the test failures.`)
})

test('/compact prune replaces the transcript itself instead of summarizing', async ($, on) => {
  const compactions: SessionCompactInput[] = []
  const toasts: string[] = []
  fakeEngine(on, compactions, toasts)

  const result = await $.session.compact({ trigger: 'manual', messages: bigTranscript(), instructions: ' prune ' })
  expect(compactions).toEqual([])
  expect(result.messages?.length).toBe(9)
  expect(result.messages?.[2]?.toolResults?.[0]?.text).toContain('pruned')
  expect(toasts[0]).toContain('1 outputs cut')
})

test('/compact prune skips when there is nothing worth cutting', async ($, on) => {
  const compactions: SessionCompactInput[] = []
  fakeEngine(on, compactions, [])
  const small: SessionMessage[] = [{ role: 'user', text: 'hi', toolUses: [] }]

  const result = await $.session.compact({ trigger: 'manual', messages: small, instructions: 'prune' })
  expect(result.skip).toContain('nothing worth cutting')
})

test('/prune-preview reports without compacting', async ($, on) => {
  const compactions: SessionCompactInput[] = []
  fakeEngine(on, compactions, [])

  const result = await $.command.run({ command: 'prune-preview', args: '', ...RUN })
  expect(compactions).toEqual([])
  expect(result.text).toContain('prune preview')
})
