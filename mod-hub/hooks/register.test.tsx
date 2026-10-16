import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { HubEntry } from '../types'

const PANE = {
  component: 'Pane',
  requestId: 'hub',
  props: {
    title: 'Mods',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const FOOTER = { plugin: 'mod-hub', component: 'SessionMode', props: { modes: [] } } as const

const IDEAS: HubEntry = {
  id: 'idea-shell',
  icon: '💡',
  title: 'Ideas',
  status: '3 for this folder',
  attention: 'none',
  actions: [
    { key: 'capture', label: 'New idea' },
    { key: 'list', label: 'Show' },
  ],
}

const CACHE: HubEntry = { id: 'cache-watch', icon: '⏳', title: 'Cache', status: 'Warm for 4m', attention: 'warning', actions: [] }

// A test's `$` carries the engine's nouns only, not the `$.hub` the mods call,
// so the entries they would have set are answered where the hub reads them.
function seed(on: On, list: HubEntry[]): void {
  on('state.get', (_$, e) => ({ value: e.key === 'entries' ? { value: list, version: 1 } : { value: undefined, version: 0 } }))
}

function fakeSession(on: On): { opened: string[]; closed: string[] } {
  const world = { opened: [] as string[], closed: [] as string[] }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', { component: 'SessionMode' }, () => ({ type: 'engine', ref: 0 }))
  on('ui.open', (_$, e) => {
    world.opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    world.closed.push(e.id)

    return { value: undefined }
  })

  return world
}

test('the pane puts what needs a look first, then the quiet mods, each with its actions', async ($, on) => {
  fakeSession(on)
  seed(on, [IDEAS, CACHE])

  const ui = await $.ui.mount({ ...PANE, plugin: 'mod-hub', surface: 'desktop' })
  const sections = (await ui.findAll({ type: 'Text', text: /^(NEEDS A LOOK|ALL QUIET)$/ })).map(i => i.text)
  const cards = (await ui.findAll({ type: 'Svg' })).map(i => String(i.props.alt))
  expect(sections).toEqual(['NEEDS A LOOK', 'ALL QUIET'])
  expect(cards).toEqual(['🧰 MODS: 1 of 2 need a look, 2 loaded', 'Cache: Warm for 4m (needs attention)', expect.stringMatching(/^Ideas: /)])
  expect(await ui.find({ key: 'idea-shell:capture', text: 'New idea' })).toBeDefined()
  await ui.unmount()

  const terminal = await $.ui.mount({ ...PANE, plugin: 'mod-hub', surface: 'terminal' })
  expect(await terminal.find({ type: 'Text', text: 'Warm for 4m' })).toBeDefined()
  await terminal.unmount()
})

test('pressing an action reaches the mod that offered it and closes the hub', async ($, on) => {
  const world = fakeSession(on)
  const pressed: string[] = []
  on('ui.press', { plugin: 'mod-hub', element: 'idea-shell:capture' }, (_$, e, next) => {
    pressed.push(e.element)

    return next(e)
  })
  seed(on, [IDEAS])

  const ui = await $.ui.mount({ ...PANE, plugin: 'mod-hub', surface: 'desktop' })
  await ui.press({ key: 'idea-shell:capture' })
  await ui.unmount()
  expect(pressed).toEqual(['idea-shell:capture'])
  expect(world.closed).toEqual(['hub'])
})

test('the footer badge counts the mods that need a look', async ($, on) => {
  fakeSession(on)
  seed(on, [IDEAS, CACHE])
  const footer = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  expect(await footer.find({ key: 'open-hub', text: '🧰 1' })).toBeDefined()
  await footer.unmount()
})

test('without any mod reporting, the pane says so and the footer shows the bare toolbox', async ($, on) => {
  const world = fakeSession(on)
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })

  const pane = await $.ui.mount({ ...PANE, plugin: 'mod-hub', surface: 'desktop' })
  expect(await pane.find({ type: 'Text', text: /No mod has reported/ })).toBeDefined()
  await pane.unmount()

  const footer = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  expect(await footer.find({ key: 'open-hub', text: '🧰' })).toBeDefined()
  await footer.press({ key: 'open-hub' })
  await footer.unmount()
  expect(world.opened).toEqual(['hub'])

  const terminal = await $.ui.mount({ ...FOOTER, surface: 'terminal' })
  expect(await terminal.find({ key: 'open-hub' })).toBeUndefined()
  await terminal.unmount()
})

test('/hub opens the pane', async ($, on) => {
  const world = fakeSession(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'hub', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  expect(world.opened).toEqual(['hub'])
})
