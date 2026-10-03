import type { On, RenderSurface } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const FOOTER = {
  component: 'SessionMode',
  props: { modes: [] },
} as const

function fakeSession(on: On, surfaces: readonly RenderSurface[]) {
  mock.env(on, { HOME: '/Users/test' })
  mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('classic.UserPromptSubmit', () => ({}))
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine footer</Text>
  })
  on('session.surfaces', () => ({ value: surfaces }))
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('session.cwd', () => ({ value: '/Users/test/Projects/app' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 420_000, window: 1_000_000, percent: 42 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 23, resetsAt: '2026-10-03T14:00:00Z' }],
      cost: { usd: 1.5 },
    },
  }))
  on('settings.read', () => ({ value: { fastMode: true } }))
  on('process.run', (_$, e) => {
    const stdout = e.argv.includes('status') ? '# branch.oid abcdef1234\n# branch.head main\n1 .M N... a b c d e f.ts\n' : '.git\n.git\n/Users/test/Projects/app\n'

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

test('the footer shows the status line figures on the desktop only', async ($, on) => {
  fakeSession(on, ['terminal', 'desktop'])
  await $.session.start({ cwd: '/Users/test/Projects/app', surface: 'terminal', isInteractive: true })
  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'plan' })

  const desktop = await $.ui.mount({ plugin: 'status-band', surface: 'desktop', ...FOOTER })
  for (const text of ['plan', 'fast', '~/Projects/app', '⎇ main', '●1', ' 42%', '23%', '$1.50']) {
    expect(await desktop.find({ type: 'Text', text })).toBeDefined()
  }
  expect(await desktop.find({ type: 'Text', text: 'Opus 5.5' })).toBeUndefined()
  await desktop.unmount()

  const terminal = await $.ui.mount({ plugin: 'status-band', surface: 'terminal', ...FOOTER })
  expect(await terminal.find({ type: 'Text', text: 'engine footer' })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: '⎇ main' })).toBeUndefined()
  await terminal.unmount()
})

test('the engine\'s own mode labels stay in the footer', async ($, on) => {
  fakeSession(on, ['desktop'])
  await $.session.start({ cwd: '/Users/test/Projects/app', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'status-band', surface: 'desktop', component: 'SessionMode', props: { modes: ['focus'] } })
  expect(await ui.find({ type: 'Text', text: 'focus' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '⎇ main' })).toBeDefined()
  await ui.unmount()
})
