import { expect, mock, test } from 'claude-code/testing'

const LISTING =
  '2026-10-03 09:58\tbaseline\tBaseline\n2026-10-03 10:09\tinitial-proper-mac-snapshot\tInitial proper mac snapshot\n'

const PANE = {
  component: 'Pane',
  requestId: 'config-snapshots',
  props: {
    title: 'Config snapshots',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

test('rollback needs a second, confirming press', async ($, on) => {
  const calls: string[][] = []
  const scripts: string[] = []
  mock.env(on, { HOME: '/Users/test' })
  on('process.run', ($, e) => {
    scripts.push(e.argv[0] ?? '')
    const args = e.argv.slice(1)
    calls.push([...args])
    const stdout = args[0] === 'list' ? LISTING : `ran ${args.join(' ')}`

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))

  for (const surface of ['terminal', 'desktop'] as const) {
    calls.length = 0
    await $.command.run({ command: 'snapshots', args: '', ...RUN })
    const ui = await $.ui.mount({ plugin: 'config-snapshots', surface, ...PANE })

    await ui.press({ key: 'select-baseline' })
    expect(calls).toContainEqual(['diff', 'baseline'])
    expect(await ui.find({ type: surface === 'terminal' ? 'Text' : 'Code', text: /ran diff baseline/ })).toBeDefined()

    await ui.press({ key: 'arm' })
    expect(calls.some(i => i[0] === 'rollback')).toBe(false)

    await ui.press({ key: 'confirm' })
    expect(calls).toContainEqual(['rollback', 'baseline'])
    await ui.unmount()
  }
  expect(scripts.every(i => i.endsWith('/config-snapshots/bin/claude-config'))).toBe(true)
})

test('the desktop pane takes a snapshot from its field and compares one in its card', async ($, on) => {
  const calls: string[][] = []
  mock.env(on, { HOME: '/Users/test' })
  on('process.run', ($, e) => {
    const args = e.argv.slice(1)
    calls.push([...args])
    const stdout = args[0] === 'list' ? LISTING : args[0] === 'diff' ? (args[1] === 'baseline' ? ' settings.json | 2 +-' : '') : `ran ${args.join(' ')}`

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))

  await $.command.run({ command: 'snapshots', args: '', ...RUN })
  const ui = await $.ui.mount({ plugin: 'config-snapshots', surface: 'desktop', ...PANE })
  await ui.input({ key: 'snapshot-name', text: '  Before the new plugin  ' })
  expect(calls).toContainEqual(['snapshot', 'Before the new plugin'])
  expect(await ui.find({ type: 'Text', text: 'ran snapshot Before the new plugin' })).toBeDefined()

  await ui.press({ key: 'select-baseline' })
  expect(await ui.find({ type: 'Code', text: /settings\.json/ })).toBeDefined()
  await ui.press({ key: 'full-diff' })
  expect(calls).toContainEqual(['diff', 'baseline', '--full'])

  await ui.press({ key: 'select-initial-proper-mac-snapshot' })
  expect(await ui.find({ type: 'Text', text: /Nothing changed since this snapshot/ })).toBeDefined()
  await ui.unmount()
})

test('snapshot without a name explains the usage', async ($, on) => {
  mock.env(on, { HOME: '/Users/test' })
  const result = await $.command.run({ command: 'snapshot', args: '', ...RUN })
  expect(result.text).toBe('Usage: /snapshot <name>')
})
