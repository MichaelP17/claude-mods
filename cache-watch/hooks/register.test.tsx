import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { Footer, Suggestion } from '../types'

function seedSuggestion(on: On, value: Suggestion) {
  on('state.get', (_$, e) => ({ value: e.key === 'suggestion' ? { value, version: 1 } : { value: undefined, version: 0 } }))
}

function seedFooter(on: On, value: Footer | null) {
  on('state.get', (_$, e) => ({ value: e.key === 'footer' ? { value, version: 1 } : { value: undefined, version: 0 } }))
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
    expect(await ui.find({ type: 'Text', text: '🏁 Milestone reached' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'compact' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'drawn beneath' })).toBeDefined()
    await ui.unmount()
  }
})

test('the suggestion draws alone when nothing is beneath', async ($, on) => {
  seedSuggestion(on, { kind: 'expiring', contextTokens: 400_000 })
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))

  const ui = await $.ui.mount({ plugin: 'cache-watch', surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: '⏳ Cache expires soon' })).toBeDefined()
  await ui.unmount()
})

test('a handoff at the repository root is announced to a session started in a subfolder', async ($, on) => {
  on('session.cwd', () => ({ value: '/repo/src' }))
  on('fs.exists', (_$, e) => ({ value: e.path === '/repo/HANDOFF.md' || e.path === '/repo/.git' }))
  on('prompt.context', (_$, e) => ({ blocks: e.blocks }))

  const { blocks } = await $.prompt.context({ blocks: [] })
  expect(blocks.find(i => i.name === 'handoff')?.text).toContain('/repo/HANDOFF.md')
})

test('without a handoff the context stays as it is', async ($, on) => {
  on('session.cwd', () => ({ value: '/repo' }))
  on('fs.exists', (_$, e) => ({ value: e.path === '/repo/.git' }))
  on('prompt.context', (_$, e) => ({ blocks: e.blocks }))

  const { blocks } = await $.prompt.context({ blocks: [] })
  expect(blocks).toEqual([])
})

test('the countdown joins the mode labels in the terminal and the drawn footer on the desktop', async ($, on) => {
  seedFooter(on, { label: '⏳ 42m', isExpiring: false })
  const modes: (readonly string[])[] = []
  on('ui.render', { component: 'SessionMode' }, (_$, e) => {
    modes.push(e.props.modes)

    return { type: 'engine', ref: 0 }
  })

  const terminal = await $.ui.mount({ plugin: 'cache-watch', surface: 'terminal', component: 'SessionMode', props: { modes: ['focus'] } })
  expect(modes.at(-1)).toEqual(['focus', '⏳ 42m'])
  await terminal.unmount()

  const desktop = await $.ui.mount({ plugin: 'cache-watch', surface: 'desktop', component: 'SessionMode', props: { modes: ['focus'] } })
  expect(await desktop.find({ type: 'Text', text: '⏳ 42m' })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: 'focus' })).toBeDefined()
  await desktop.unmount()
})

test('without a countdown the footer stays as the engine draws it', async ($, on) => {
  seedFooter(on, null)
  on('ui.render', { component: 'SessionMode' }, () => ({ type: 'engine', ref: 0 }))

  const desktop = await $.ui.mount({ plugin: 'cache-watch', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  expect(await desktop.find({ type: 'Text', text: /⏳|🧊/ })).toBeUndefined()
  await desktop.unmount()
})
