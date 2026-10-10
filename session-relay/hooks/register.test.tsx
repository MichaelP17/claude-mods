import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const HOME = '/Users/test'
const RELAY = `${HOME}/.claude/relay/clued`
const LEAD_ROOT = `${HOME}/Projects/motion-studio`
const WORKER_ROOT = `${HOME}/Projects/Clued`
const NOW = 1_000_000

const LONG = 'Render the Zlatan clip again with one stop per bar. '.repeat(10).trim()

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

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

const PANE = {
  component: 'Pane',
  requestId: 'relay',
  props: {
    title: 'Relay',
    isFocused: true,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

type World = {
  files: Map<string, string>
  sessionId: string
  messages: { role: 'user' | 'assistant'; text: string; toolUses: [] }[]
  toasts: string[]
  notes: string[]
  statuses: (string | undefined)[]
  submitted: { text: string; context: readonly string[] | undefined; origin: string }[]
  commands: string[]
}

function childrenOf(files: Map<string, string>, directory: string) {
  const names = new Map<string, 'file' | 'dir'>()
  for (const path of files.keys()) {
    if (!path.startsWith(`${directory}/`)) {
      continue
    }
    const [name = '', ...rest] = path.slice(directory.length + 1).split('/')
    names.set(name, rest.length > 0 ? 'dir' : 'file')
  }

  return [...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false }))
}

function fakeEngine(on: On, root: string, files: Record<string, string> = {}, stored: Record<string, unknown> = {}) {
  const world: World = {
    files: new Map(Object.entries(files)),
    sessionId: 'session-1',
    messages: [],
    toasts: [],
    notes: [],
    statuses: [],
    submitted: [],
    commands: [],
  }
  mock.env(on, { HOME })
  mock.store(on, stored)
  const clock = mock.clock(on, { now: NOW })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.root', () => ({ value: root }))
  on('session.id', () => ({ value: world.sessionId }))
  on('session.messages', () => ({ value: world.messages }))
  on('fs.exists', (_$, e) => ({
    value: world.files.has(e.path) || [...world.files.keys()].some(i => i.startsWith(`${e.path}/`)),
  }))
  on('fs.read', (_$, e) => ({ value: world.files.get(e.path) ?? '' }))
  on('fs.write', (_$, e) => {
    world.files.set(e.path, e.text)

    return { value: undefined }
  })
  on('fs.list', (_$, e) => ({ value: childrenOf(world.files, e.path ?? root) }))
  on('process.run', (_$, e) => {
    if (e.argv[0] === 'rm') {
      e.argv.slice(2).forEach(i => world.files.delete(i))
    }

    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', (_$, e) => {
    world.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.notify', (_$, e) => {
    world.notes.push(e.text)

    return { value: { isSent: true, channel: 'ghostty' } }
  })
  on('ui.status', (_$, e) => {
    world.statuses.push(e.text)

    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('prompt.submit', (_$, e) => {
    world.submitted.push({ text: e.text, context: e.context, origin: e.origin.kind })

    return { text: e.text }
  })
  on('command.run', { command: 'clear' }, () => {
    world.commands.push('clear')
    world.sessionId = 'session-2'

    return {}
  })

  return { world, clock }
}

function filesIn(world: World, directory: string): string[] {
  return [...world.files.keys()].filter(i => i.startsWith(`${directory}/`)).sort()
}

function startOf(root: string) {
  return { cwd: root, surface: 'terminal', isInteractive: true } as const
}

function turnOf(answer: string) {
  return { answer, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' } as const
}

test('a lead offers a fenced prompt from its answer and sends it to the worker', async ($, on) => {
  const { world } = fakeEngine(on, LEAD_ROOT)
  await $.session.start(startOf(LEAD_ROOT))
  await $.command.run({ command: 'relay', args: 'lead Clued', ...RUN })
  expect(world.statuses.at(-1)).toBe('⇄ clued · no worker open')

  await $.turn.complete(turnOf(`Looks right.\n\n**Zum Einfügen:**\n\n\`\`\`\n${LONG}\n\`\`\`\n\n\`\`\`bash\nnode render.mjs\n\`\`\``))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'session-relay', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /^Prompt for clued · 519 chars · Render the Zlatan clip/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ plugin: 'session-relay', surface: 'terminal', ...BAND })
  await ui.press({ key: 'send-fresh' })
  const sent = filesIn(world, `${RELAY}/to-worker`)
  expect(sent.length).toBe(1)
  expect(JSON.parse(world.files.get(sent[0] ?? '') ?? '{}')).toEqual(expect.objectContaining({ text: LONG, isFresh: true }))
  expect(world.toasts.at(-1)).toBe('Sent to clued · as a fresh session · no clued session is open, it waits there')
  expect(await ui.find({ type: 'Text', text: /Prompt for clued/ })).toBeUndefined()
  await ui.unmount()
})

test('a new task replaces one the worker has not picked up yet', async ($, on) => {
  const old = { id: '00000000000001-aaaaaa', text: 'old task', isFresh: false, sentAt: 1 }
  const { world } = fakeEngine(on, LEAD_ROOT, { [`${RELAY}/to-worker/${old.id}.json`]: JSON.stringify(old) })
  await $.session.start(startOf(LEAD_ROOT))
  await $.command.run({ command: 'relay', args: 'lead', ...RUN })
  await $.command.run({ command: 'relay', args: 'send Just this line', ...RUN })

  const sent = filesIn(world, `${RELAY}/to-worker`)
  expect(sent.length).toBe(1)
  expect(JSON.parse(world.files.get(sent[0] ?? '') ?? '{}').text).toBe('Just this line')
  expect(world.toasts.at(-1)).toContain('replaces the task not picked up yet')
})

test('/relay send without text takes the last fenced block of the last answer', async ($, on) => {
  const { world } = fakeEngine(on, LEAD_ROOT)
  world.messages.push({ role: 'assistant', text: `Here:\n\n\`\`\`\nShort prompt.\n\`\`\``, toolUses: [] })
  await $.session.start(startOf(LEAD_ROOT))
  await $.command.run({ command: 'relay', args: 'lead clued', ...RUN })
  await $.command.run({ command: 'relay', args: 'send', ...RUN })

  const sent = filesIn(world, `${RELAY}/to-worker`)
  expect(JSON.parse(world.files.get(sent[0] ?? '') ?? '{}').text).toBe('Short prompt.')
})

test('a worker takes a task into a fresh session as the user\'s prompt and reports its answer back', async ($, on) => {
  const task = { id: '00000000000001-aaaaaa', text: LONG, isFresh: true, sentAt: 1 }
  const { world } = fakeEngine(on, WORKER_ROOT, { [`${RELAY}/to-worker/${task.id}.json`]: JSON.stringify(task) })
  await $.session.start(startOf(WORKER_ROOT))
  await $.command.run({ command: 'relay', args: 'worker', ...RUN })

  expect(JSON.parse(world.files.get(`${RELAY}/worker.json`) ?? '{}').sessionId).toBe('session-1')
  expect(world.toasts).toContain(`Task from the lead: ${LONG.slice(0, 69).trimEnd()}…`)
  expect(world.statuses.at(-1)).toBe('⇄ clued · worker · task waiting')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'session-relay', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /^Task from the lead · for a fresh session/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ plugin: 'session-relay', surface: 'desktop', ...BAND })
  await ui.press({ key: 'send-fresh' })
  await ui.unmount()
  expect(world.commands).toEqual(['clear'])
  expect(world.submitted.map(i => i.text)).toEqual([LONG])
  expect(filesIn(world, `${RELAY}/to-worker`)).toEqual([])
  expect(JSON.parse(world.files.get(`${RELAY}/worker.json`) ?? '{}').sessionId).toBe('session-2')

  await $.turn.start({ text: LONG, turnId: 't1' })
  expect(JSON.parse(world.files.get(`${RELAY}/worker.json`) ?? '{}').busySince).toBe(NOW)

  await $.turn.complete(turnOf('Rendered both clips and committed.'))
  const answers = filesIn(world, `${RELAY}/to-lead`)
  expect(answers.length).toBe(1)
  expect(JSON.parse(world.files.get(answers[0] ?? '') ?? '{}').text).toBe('Rendered both clips and committed.')
  expect(JSON.parse(world.files.get(`${RELAY}/worker.json`) ?? '{}').busySince).toBeNull()
})

test('a second worker session leaves a live worker alone until the person works in it', async ($, on) => {
  const live = { sessionId: 'other', busySince: null, seenAt: NOW - 10_000 }
  const task = { id: '00000000000001-aaaaaa', text: 'task', isFresh: false, sentAt: 1 }
  const { world } = fakeEngine(
    on,
    WORKER_ROOT,
    { [`${RELAY}/worker.json`]: JSON.stringify(live), [`${RELAY}/to-worker/${task.id}.json`]: JSON.stringify(task) },
    { [`link:${WORKER_ROOT}`]: { role: 'worker', channel: 'clued' } },
  )
  await $.session.start(startOf(WORKER_ROOT))

  expect(world.statuses.at(-1)).toBe('⇄ clued · worker · another session is the worker')
  expect(world.toasts).toEqual([])
  const ui = await $.ui.mount({ plugin: 'session-relay', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /another session in this folder is the worker/ })).toBeDefined()

  await $.turn.complete(turnOf('An answer of the inactive session'))
  expect(filesIn(world, `${RELAY}/to-lead`)).toEqual([])

  await ui.press({ key: 'take-over' })
  expect(JSON.parse(world.files.get(`${RELAY}/worker.json`) ?? '{}').sessionId).toBe('session-1')
  expect(await ui.find({ type: 'Text', text: /^Task from the lead/ })).toBeDefined()
  await ui.unmount()
})

test('a lead announces answers, notifies for new ones and attaches them to the next prompt', async ($, on) => {
  const first = { id: '00000000000002-bbbbbb', text: 'Rendered both clips.', finishedAt: NOW - 60_000 }
  const presence = { sessionId: 'w', busySince: null, seenAt: NOW }
  const { world, clock } = fakeEngine(on, LEAD_ROOT, {
    [`${RELAY}/to-lead/${first.id}.json`]: JSON.stringify(first),
    [`${RELAY}/worker.json`]: JSON.stringify(presence),
  })
  await $.session.start(startOf(LEAD_ROOT))
  await $.command.run({ command: 'relay', args: 'lead', ...RUN })

  expect(world.toasts).toContain('clued answered: Rendered both clips.')
  expect(world.notes).toEqual([])

  const second = { id: '00000000000003-cccccc', text: 'Handoff written.', finishedAt: NOW }
  world.files.set(`${RELAY}/to-lead/${second.id}.json`, JSON.stringify(second))
  world.files.set(`${RELAY}/worker.json`, JSON.stringify({ ...presence, seenAt: NOW + 2_000 }))
  await clock.advance(2_000)
  expect(world.notes).toEqual(['Handoff written.'])
  expect(world.statuses.at(-1)).toBe('⇄ clued · 2 answers waiting')

  const ui = await $.ui.mount({ plugin: 'session-relay', surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: /^clued answered 2× · 16 chars · Handoff written\./ })).toBeDefined()
  await ui.press({ key: 'attach' })
  expect(world.statuses.at(-1)).toBe('⇄ clued · 2 answers attached')
  expect(await ui.find({ type: 'Text', text: /go with your next prompt/ })).toBeDefined()
  await ui.unmount()

  await $.prompt.submit({ text: 'Slower please', wait: false, origin: { kind: 'composer' } })
  const submitted = world.submitted.at(-1)
  expect(submitted?.text).toBe('Slower please')
  expect(submitted?.context?.[0]).toContain('The latest 2 answers from the Claude session working on "clued"')
  expect(filesIn(world, `${RELAY}/to-lead`)).toEqual([])
  expect(world.statuses.at(-1)).toBe('⇄ clued')
})

test('Forward now hands the answer to the lead as the user\'s message', async ($, on) => {
  const answer = { id: '00000000000002-bbbbbb', text: 'Rendered both clips.', finishedAt: NOW }
  const { world } = fakeEngine(
    on,
    LEAD_ROOT,
    { [`${RELAY}/to-lead/${answer.id}.json`]: JSON.stringify(answer) },
    { [`link:${LEAD_ROOT}`]: { role: 'lead', channel: 'clued' } },
  )
  await $.session.start(startOf(LEAD_ROOT))

  const ui = await $.ui.mount({ plugin: 'session-relay', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: 'Answer 1 of 1 from clued · 20 chars' })).toBeDefined()
  await ui.press({ key: 'pane-forward' })
  await ui.unmount()

  expect(world.submitted.at(-1)?.text).toBe(
    'The latest answer from the Claude session working on "clued", relayed unchanged:\n\nRendered both clips.',
  )
  expect(filesIn(world, `${RELAY}/to-lead`)).toEqual([])
})

test('linking a worker folder as lead frees its worker slot and says what it was', async ($, on) => {
  const { world } = fakeEngine(on, WORKER_ROOT)
  await $.session.start(startOf(WORKER_ROOT))
  await $.command.run({ command: 'relay', args: 'worker', ...RUN })
  expect(world.files.has(`${RELAY}/worker.json`)).toBe(true)

  await $.command.run({ command: 'relay', args: 'lead relay-test', ...RUN })
  expect(world.files.has(`${RELAY}/worker.json`)).toBe(false)
  expect(world.toasts.at(-1)).toContain('This folder was the worker of clued until now.')
  expect(world.statuses.at(-1)).toBe('⇄ relay-test · no worker open')
})

test('/relay off forgets the folder and frees the worker slot', async ($, on) => {
  const { world } = fakeEngine(on, WORKER_ROOT, {}, { [`link:${WORKER_ROOT}`]: { role: 'worker', channel: 'clued' } })
  await $.session.start(startOf(WORKER_ROOT))
  expect(world.files.has(`${RELAY}/worker.json`)).toBe(true)

  await $.command.run({ command: 'relay', args: 'off', ...RUN })
  expect(world.files.has(`${RELAY}/worker.json`)).toBe(false)
  expect(world.statuses.at(-1)).toBeUndefined()
  expect(world.toasts.at(-1)).toBe('Left clued; this folder no longer joins it.')
})
