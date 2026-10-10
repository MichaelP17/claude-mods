import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { parseQuestions, roundKeyOf } from './rounds'

const ROOT = '/Users/test/Projects/app'
const DAY = 24 * 60 * 60 * 1000

const ROUND = `Next round.

❓ **Q1** - **Answers**: Where do answers go?

➡️ The panel

❓ **Q2** - **Name**: What is it called?

➡️ grill-panel

❓ **Q3** - **Push**: Push right away?

➡️ Not before testing`

const KEY = `round:${roundKeyOf(ROOT, parseQuestions(ROUND))}`

const TURN = { answer: ROUND, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' } as const

const PANE = {
  component: 'Pane',
  requestId: 'grill',
  props: {
    title: 'Grill',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const START = { cwd: ROOT, surface: 'terminal', isInteractive: true } as const

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

type World = {
  messages: { role: 'user' | 'assistant'; text: string; toolUses: [] }[]
  store: Map<string, unknown>
  opened: string[]
  closed: string[]
  toasts: string[]
  submitted: string[]
  isPlaced: boolean
}

async function footerText($: Engine): Promise<string | undefined> {
  const ui = await $.ui.mount({ plugin: 'grill-panel', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  const label = await ui.find({ type: 'Text', text: /🔥/ })
  await ui.unmount()

  return label?.text
}

function fakeEngine(on: On, stored: Record<string, unknown> = {}, now = 100 * DAY): World {
  const world: World = {
    messages: [],
    store: new Map(Object.entries(stored)),
    opened: [],
    closed: [],
    toasts: [],
    submitted: [],
    isPlaced: true,
  }
  on('store.get', (_$, e) => ({ value: world.store.get(e.key) }))
  on('store.set', (_$, e) => {
    world.store.set(e.key, e.value)

    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    world.store.delete(e.key)

    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...world.store.keys()] }))
  mock.clock(on, { now })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.root', () => ({ value: ROOT }))
  on('session.messages', () => ({ value: world.messages }))
  on('turn.complete', () => ({ text: '' }))
  on('skill.prompt', (_$, e) => ({ text: e.text }))
  on('ui.open', (_$, e) => {
    world.opened.push(e.id)

    return { value: world.isPlaced ? { isPlaced: true } : { isPlaced: false, reason: 'narrow' } }
  })
  on('ui.close', (_$, e) => {
    world.closed.push(e.id)

    return { value: undefined }
  })
  on('ui.render', { component: 'SessionMode' }, () => ({ type: 'engine', ref: 0 }))
  on('ui.toast', (_$, e) => {
    world.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.focus', () => ({}))
  on('prompt.submit', (_$, e) => {
    world.submitted.push(e.text)

    return { text: e.text }
  })

  return world
}

test('a turn ending on a round opens the panel on the first question', async ($, on) => {
  const world = fakeEngine(on)
  await $.session.start(START)
  await $.turn.complete(TURN)

  expect(world.opened).toEqual(['grill'])
  expect(await footerText($)).toBe('🔥 0/3')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'grill-panel', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /^Q1 · Answers$/ })).toBeDefined()
    expect(await ui.find({ type: 'Markdown', text: '➡️ The panel' })).toBeDefined()
    expect(await ui.find({ key: 'back' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a subagent turn, an interrupted one and one without questions leave the panel alone', async ($, on) => {
  const world = fakeEngine(on)
  await $.session.start(START)
  await $.turn.complete({ ...TURN, agentId: 'a1' })
  await $.turn.complete({ ...TURN, reason: 'aborted', isAborted: true })
  await $.turn.complete({ ...TURN, answer: 'Nothing to ask.' })
  expect(world.opened).toEqual([])

  await $.turn.complete(TURN)
  await $.turn.complete({ ...TURN, answer: 'The panel is a side pane.' })
  expect(world.opened).toEqual(['grill'])
  expect(world.closed).toEqual([])
})

test('answering every question, the last by taking the recommendation, sends Q lines', async ($, on) => {
  const world = fakeEngine(on)
  await $.session.start(START)
  await $.turn.complete(TURN)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'grill-panel', surface, ...PANE })
    if (surface === 'terminal') {
      await ui.input({ key: 'answer', text: 'In the panel\nfor sure' })
      await ui.input({ key: 'answer', text: 'grill-panel' })
      await ui.input({ key: 'answer', text: '   ' })
    }
    expect(await ui.find({ type: 'Text', text: 'All questions answered' })).toBeDefined()
    expect(await ui.find({ key: 'edit-2', text: /recommendation accepted/ })).toBeDefined()
    await ui.unmount()
  }
  expect(await footerText($)).toBe('🔥 3/3')

  const ui = await $.ui.mount({ plugin: 'grill-panel', surface: 'desktop', ...PANE })
  await ui.press({ key: 'send' })
  await ui.unmount()
  expect(world.submitted).toEqual(['Q1: In the panel\nfor sure\n\nQ2: grill-panel\n\nQ3: Recommendation accepted'])
  expect(world.closed).toEqual(['grill'])
  expect(await footerText($)).toBeUndefined()
})

test('a pane a narrow terminal leaves undrawn is pointed to with a toast', async ($, on) => {
  const world = fakeEngine(on)
  world.isPlaced = false
  await $.session.start(START)
  await $.turn.complete(TURN)

  expect(world.toasts).toEqual(['Question round ready · /grill opens it'])
  expect(await footerText($)).toBe('🔥 0/3')
})

test('a question without a recommendation needs a typed answer', async ($, on) => {
  const world = fakeEngine(on)
  await $.session.start(START)
  await $.turn.complete({ ...TURN, answer: '❓ **Q1** - **Free**: Anything?\n\n❓ **Q2** - **Next**: More?\n\n➡️ yes' })
  const ui = await $.ui.mount({ plugin: 'grill-panel', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'edit-recommendation' })).toBeUndefined()

  await ui.input({ key: 'answer', text: '' })
  expect(world.toasts).toEqual(['This question has no recommendation to take; type an answer.'])
  expect(await ui.find({ type: 'Text', text: /^Q1 · Free$/ })).toBeDefined()
  await ui.unmount()
})

test('skip, back, edit recommendation and edit from the review', async ($, on) => {
  const world = fakeEngine(on)
  await $.session.start(START)
  await $.turn.complete(TURN)
  const ui = await $.ui.mount({ plugin: 'grill-panel', surface: 'terminal', ...PANE })

  await ui.press({ key: 'skip' })
  expect(await ui.find({ type: 'Text', text: /^Q2 · Name$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '↷ Q1 · Answers' })).toBeDefined()

  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Text', text: '› Q1 · Answers' })).toBeDefined()

  await ui.press({ key: 'edit-recommendation' })
  expect(await ui.find({ key: 'answer', text: 'The panel' })).toBeDefined()
  await ui.input({ key: 'answer', text: 'The panel, docked' })
  await ui.input({ key: 'answer', text: 'grill-panel' })
  await ui.input({ key: 'answer', text: 'No' })

  await ui.press({ key: 'edit-0' })
  expect(await ui.find({ key: 'answer', text: 'The panel, docked' })).toBeDefined()
  await ui.input({ key: 'answer', text: 'The panel' })
  expect(await ui.find({ type: 'Text', text: 'All questions answered' })).toBeDefined()
  await ui.unmount()
  expect(world.submitted).toEqual([])
})

test('sending early asks first and marks open questions', async ($, on) => {
  const world = fakeEngine(on)
  await $.session.start(START)
  await $.turn.complete(TURN)
  const ui = await $.ui.mount({ plugin: 'grill-panel', surface: 'desktop', ...PANE })
  await ui.input({ key: 'answer', text: 'Panel' })

  await ui.press({ key: 'send' })
  expect(await ui.find({ type: 'Text', text: /2 of 3 questions are unanswered/ })).toBeDefined()
  await ui.press({ key: 'cancel' })
  expect(await ui.find({ type: 'Text', text: /^Q2 · Name$/ })).toBeDefined()

  await ui.press({ key: 'send' })
  await ui.press({ key: 'confirm-send' })
  await ui.unmount()
  expect(world.submitted).toEqual(['Q1: Panel\n\nQ2: (unanswered)\n\nQ3: (unanswered)'])
})

test('each confirmed answer is saved at once, and nothing before it', async ($, on) => {
  const world = fakeEngine(on)
  await $.session.start(START)
  await $.turn.complete(TURN)
  expect([...world.store.keys()]).toEqual([])

  const ui = await $.ui.mount({ plugin: 'grill-panel', surface: 'terminal', ...PANE })
  await ui.input({ key: 'answer', text: 'Pan', kind: 'change' })
  expect([...world.store.keys()]).toEqual([])
  await ui.input({ key: 'answer', text: 'Panel' })
  await ui.unmount()

  expect([...world.store.keys()]).toEqual([KEY])
  expect(world.store.get(KEY)).toEqual({ status: 'open', answers: [{ kind: 'text', text: 'Panel' }, null, null], updatedAt: 100 * DAY })
})

test('after a restart the conversation ending on the round picks up where it stopped', async ($, on) => {
  const world = fakeEngine(on, { [KEY]: { status: 'open', answers: [{ kind: 'text', text: 'Panel' }, null, null], updatedAt: 99 * DAY } })
  world.messages.push({ role: 'assistant', text: ROUND, toolUses: [] })
  await $.session.start(START)

  expect(world.opened).toEqual(['grill'])
  expect(await footerText($)).toBe('🔥 1/3')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'grill-panel', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: '✓ Q1 · Answers' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Q2 · Name$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a conversation that moved on past the round is not offered it again', async ($, on) => {
  const world = fakeEngine(on, { [KEY]: { status: 'open', answers: [{ kind: 'text', text: 'Panel' }, null, null], updatedAt: 99 * DAY } })
  world.messages.push({ role: 'assistant', text: ROUND, toolUses: [] })
  world.messages.push({ role: 'user', text: 'Q1: Panel', toolUses: [] })
  world.messages.push({ role: 'assistant', text: 'Noted.', toolUses: [] })
  await $.session.start(START)
  expect(world.opened).toEqual([])
})

test('an in-process /resume swaps in the round of the resumed conversation', async ($, on) => {
  const world = fakeEngine(on)
  await $.session.start(START)
  await $.turn.complete({ ...TURN, answer: '❓ **Q1** - **Other**: Other conversation?\n\n➡️ yes' })

  world.messages.push({ role: 'assistant', text: ROUND, toolUses: [] })
  await $.classic.SessionStart({ source: 'resume' })
  expect(world.closed).toEqual(['grill'])
  const ui = await $.ui.mount({ plugin: 'grill-panel', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^Q1 · Answers$/ })).toBeDefined()
  await ui.unmount()
})

test('/clear drops the round from the screen but keeps its answers', async ($, on) => {
  const world = fakeEngine(on)
  await $.session.start(START)
  await $.turn.complete(TURN)
  await $.classic.SessionStart({ source: 'clear' })
  expect(world.closed).toEqual(['grill'])
  expect(await footerText($)).toBeUndefined()
})

test('a discarded round stays closed on resume, and /grill brings it back', async ($, on) => {
  const world = fakeEngine(on)
  world.messages.push({ role: 'assistant', text: ROUND, toolUses: [] })
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'grill-panel', surface: 'terminal', ...PANE })
  await ui.input({ key: 'answer', text: 'Panel' })
  await ui.press({ key: 'discard' })
  expect(await ui.find({ type: 'Text', text: /Discard this round/ })).toBeDefined()
  await ui.press({ key: 'confirm-discard' })
  await ui.unmount()
  expect(world.closed).toEqual(['grill'])

  await $.classic.SessionStart({ source: 'resume' })
  expect(world.opened).toEqual(['grill'])

  await $.command.run({ command: 'grill', args: '', ...RUN })
  expect(world.opened).toEqual(['grill', 'grill'])
  const back = await $.ui.mount({ plugin: 'grill-panel', surface: 'terminal', ...PANE })
  expect(await back.find({ type: 'Text', text: '✓ Q1 · Answers' })).toBeDefined()
  await back.unmount()
})

test('/grill without any round says so and opens nothing', async ($, on) => {
  const world = fakeEngine(on)
  await $.session.start(START)
  const result = await $.command.run({ command: 'grill', args: '', ...RUN })
  expect(result.text).toBeUndefined()
  expect(world.toasts).toEqual(['No question round in this conversation.'])
  expect(world.opened).toEqual([])
})

test('entries older than 30 days are dropped at start', async ($, on) => {
  const world = fakeEngine(on, {
    'round:old': { status: 'open', answers: [], updatedAt: 60 * DAY },
    'round:fresh': { status: 'done', answers: [], updatedAt: 90 * DAY },
    'round:broken': 'nonsense',
  })
  await $.session.start(START)
  expect([...world.store.keys()]).toEqual(['round:fresh'])
})

test('the grilling skill is told the format the panel reads', async ($, on) => {
  fakeEngine(on)
  await $.session.start(START)
  const result = await $.skill.prompt({ skill: 'grilling', text: 'Interview the user.' })
  expect(result.text).toContain('Interview the user.\n\n## Answer panel')
  expect(result.text).toContain('❓ **Q<n>** - **<title>**: <body>')

  const other = await $.skill.prompt({ skill: 'commit', text: 'Commit.' })
  expect(other.text).toBe('Commit.')
})

test('mobile, which draws no text field, points elsewhere', async ($, on) => {
  fakeEngine(on)
  await $.session.start(START)
  await $.turn.complete(TURN)
  const ui = await $.ui.mount({ plugin: 'grill-panel', surface: 'mobile', ...PANE })
  expect(await ui.find({ type: 'Text', text: /answer this round in the terminal or the desktop app/ })).toBeDefined()
  await ui.unmount()
})
