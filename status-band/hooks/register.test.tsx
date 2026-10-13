import type { On, RenderSurface } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

function fakeSession(on: On, surfaces: readonly RenderSurface[], below: string | null = 'engine footer') {
  mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 100_000, window: 1_000_000, percent: 10 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 74, resetsAt: '2026-10-03T14:00:00Z' },
        { kind: 'seven_day', percentUsed: 98, resetsAt: '2026-10-07T09:00:00Z' },
      ],
      cost: { usd: 1.5 },
    },
  }))
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    if (below === null) {
      return { type: 'engine', ref: 0 }
    }
    const { Text } = $.ui.resolve(e)

    return <Text>{below}</Text>
  })
}

test('the footer shows context and both limits on the desktop only', async ($, on) => {
  fakeSession(on, ['terminal', 'desktop'])
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const desktop = await $.ui.mount({ plugin: 'status-band', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  for (const text of ['C ', '10%', '5h ', '74%', 'W ', '98%']) {
    expect(await desktop.find({ type: 'Text', text })).toBeDefined()
  }
  await desktop.unmount()

  const terminal = await $.ui.mount({ plugin: 'status-band', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect(await terminal.find({ type: 'Text', text: 'engine footer' })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: '10%' })).toBeUndefined()
  await terminal.unmount()
})

test('the engine\'s own mode labels stay in front', async ($, on) => {
  fakeSession(on, ['desktop'], null)
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'status-band', surface: 'desktop', component: 'SessionMode', props: { modes: ['focus'] } })
  expect(await ui.find({ type: 'Text', text: 'focus · ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '74%' })).toBeDefined()
  await ui.unmount()
})

test('a footer another mod drew stays in front', async ($, on) => {
  fakeSession(on, ['desktop'], '🍄 1-1')
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'status-band', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  expect(await ui.find({ type: 'Text', text: '🍄 1-1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '74%' })).toBeDefined()
  await ui.unmount()
})

test('a mod beneath that draws only a button gets no separator, one with text does', async ($, on) => {
  let isButtonOnly = true
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row">
        <Button key="bulb" plain label="💡" onPress={() => undefined} />
        {isButtonOnly ? null : <Text>⏳ 40m</Text>}
      </Box>
    )
  })
  fakeSession(on, ['desktop'], null)
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })

  const desktop = await $.ui.mount({ plugin: 'status-band', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  expect(await desktop.find({ key: 'bulb' })).toBeDefined()
  expect((await desktop.findAll({ type: 'Text', text: /^ · $/ })).length).toBe(2)
  expect(await desktop.find({ type: 'Text', text: '10%' })).toBeDefined()
  await desktop.unmount()

  isButtonOnly = false
  const withText = await $.ui.mount({ plugin: 'status-band', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  expect(await withText.find({ type: 'Text', text: '⏳ 40m' })).toBeDefined()
  expect((await withText.findAll({ type: 'Text', text: /^ · $/ })).length).toBe(3)
  await withText.unmount()
})
