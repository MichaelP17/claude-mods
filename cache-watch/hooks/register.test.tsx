import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { Suggestion } from '../types'

function seedSuggestion(on: On, value: Suggestion) {
  on('state.get', (_$, e) => ({ value: e.key === 'suggestion' ? { value, version: 1 } : { value: undefined, version: 0 } }))
}

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

test('the suggestion keeps a band drawn beneath it visible on every surface', async ($, on) => {
  seedSuggestion(on, { kind: 'milestone', contextTokens: 400_000 })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>drawn beneath</Text>
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'cache-watch', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /Milestone reached/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'drawn beneath' })).toBeDefined()
    await ui.unmount()
  }
})

test('the suggestion draws alone when nothing is beneath', async ($, on) => {
  seedSuggestion(on, { kind: 'expiring', contextTokens: 400_000 })
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))

  const ui = await $.ui.mount({ plugin: 'cache-watch', surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: /Prompt cache expires soon/ })).toBeDefined()
  await ui.unmount()
})
