import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'service-radar',
  props: {
    title: 'Services',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

const FOOTER = { plugin: 'service-radar', surface: 'desktop', component: 'SessionMode', props: { modes: [] } } as const

function fakeDocker(on: On, calls: string[]) {
  let running = true
  on('process.run', (_$, e) => {
    const line = `${e.init?.cwd ?? ''} $ ${e.argv.join(' ')}`
    calls.push(line)
    if (e.argv.includes('down')) {
      running = false
    }
    const stdout = e.argv.includes('ps') && running ? 'abc123\n' : ''

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

test('a detached compose stack is tracked, shown and stopped from the pane', async ($, on) => {
  const calls: string[] = []
  mock.store(on)
  mock.env(on, { HOME: '/Users/test' })
  const clock = mock.clock(on)
  fakeDocker(on, calls)
  on('session.cwd', () => ({ value: '/repo' }))
  on('ui.render', { component: 'SessionMode' }, () => ({ type: 'engine', ref: 0 }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))

  await $.tool.call({ tool: 'Bash', command: 'cd app && docker compose up -d' })
  const footer = await $.ui.mount(FOOTER)
  expect(await footer.find({ type: 'Text', text: '🐳 1' })).toBeDefined()
  await footer.unmount()

  await $.command.run({ command: 'services', args: '', ...RUN })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'service-radar', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /docker compose: app/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ plugin: 'service-radar', surface: 'terminal', ...PANE })
  const stopKey = (await ui.findAll({ type: 'Button' })).find(i => i.key?.startsWith('stop-'))?.key ?? ''
  await ui.press({ key: stopKey })
  await clock.advance(1)
  expect(calls).toContain('/repo/app $ docker compose down')
  await ui.unmount()
  const emptyFooter = await $.ui.mount(FOOTER)
  expect(await emptyFooter.find({ type: 'Text', text: /🐳/ })).toBeUndefined()
  await emptyFooter.unmount()
})

test('/clear offers to stop running services first', async ($, on) => {
  const calls: string[] = []
  const asked: string[] = []
  let cleared = false
  mock.store(on)
  mock.env(on, { HOME: '/Users/test' })
  fakeDocker(on, calls)
  on('session.cwd', () => ({ value: '/repo' }))
  on('clock.now', () => ({ value: 0 }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const question = e.questions[0]?.question ?? ''
    asked.push(question)

    return { result: { questions: e.questions, answers: { [question]: 'Stop all' } } }
  })
  on('command.run', { command: 'clear' }, () => {
    cleared = true

    return { text: 'cleared' }
  })

  await $.tool.call({ tool: 'Bash', command: 'docker compose up -d' })
  await $.command.run({ command: 'clear', args: '', ...RUN })
  expect(asked[0]).toContain('docker compose: repo')
  expect(calls).toContain('/repo $ docker compose down')
  expect(cleared).toBe(true)
})

test('/clear without running services asks nothing', async ($, on) => {
  const asked: string[] = []
  mock.store(on)
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    asked.push(e.questions[0]?.question ?? '')

    return { result: { questions: e.questions, answers: {} } }
  })
  on('command.run', { command: 'clear' }, () => ({ text: 'cleared' }))

  await $.command.run({ command: 'clear', args: '', ...RUN })
  expect(asked).toHaveLength(0)
})

test('a bare desktop PATH still finds Homebrew tools', async ($, on) => {
  const runs: { argv: readonly string[]; path: string | undefined }[] = []
  mock.store(on)
  mock.env(on, { HOME: '/Users/test', PATH: '/usr/bin:/bin:/usr/sbin:/sbin' })
  mock.clock(on)
  on('session.cwd', () => ({ value: '/repo' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.exists', (_$, e) => ({ value: e.path === '/opt/homebrew/bin/docker' }))
  on('process.run', (_$, e) => {
    runs.push({ argv: e.argv, path: e.init?.env?.PATH })

    return { value: { exitCode: 0, stdout: 'abc123\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))

  await $.tool.call({ tool: 'Bash', command: 'cd app && docker compose up -d' })
  await $.command.run({ command: 'services', args: '', ...RUN })

  expect(runs.length).toBeGreaterThan(0)
  expect(runs.every(i => i.argv[0] === '/opt/homebrew/bin/docker')).toBe(true)
  expect(runs.every(i => i.path === '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin')).toBe(true)
})
