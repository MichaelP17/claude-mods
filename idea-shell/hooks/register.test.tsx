import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const FILE = '/Users/test/.claude/ideas/home/Projects/app.md'

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

const PANE_PROPS = {
  isFocused: true,
  bodyColumns: 80,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

const CAPTURE = { component: 'Pane', requestId: 'idea', props: { title: 'New idea', ...PANE_PROPS } } as const
const LIST = { component: 'Pane', requestId: 'ideas', props: { title: 'Ideas', ...PANE_PROPS } } as const

type Disk = { files: Map<string, string>; fills: string[]; closed: string[]; modes: (readonly string[])[] }

function fakeSession(on: On, files: Record<string, string> = {}): Disk {
  const disk: Disk = { files: new Map(Object.entries(files)), fills: [], closed: [], modes: [] }
  mock.env(on, { HOME: '/Users/test' })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__idea-shell__${e.name}` } }))
  on('session.root', () => ({ value: '/Users/test/Projects/app' }))
  on('fs.exists', (_$, e) => ({ value: disk.files.has(e.path) }))
  on('fs.read', (_$, e) => ({ value: disk.files.get(e.path) ?? '' }))
  on('fs.write', (_$, e) => {
    disk.files.set(e.path, e.text)

    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    if (e.argv[0] === 'rm') {
      disk.files.delete(e.argv.at(-1) ?? '')
    }

    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_$, e) => {
    disk.fills.push(e.text)

    return { isFilled: true }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', (_$, e) => {
    disk.closed.push(e.id)

    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', { component: 'SessionMode' }, (_$, e) => {
    disk.modes.push(e.props.modes)

    return { type: 'engine', ref: 0 }
  })

  return disk
}

test('/idea with text saves it to this folder\'s file and prints nothing', async ($, on) => {
  const disk = fakeSession(on, { [FILE]: '- older idea\n' })
  await $.session.start({ cwd: '/Users/test/Projects/app', surface: 'terminal', isInteractive: true })

  const result = await $.command.run({ command: 'idea', args: '  Make the timeout configurable ', ...RUN })
  expect(result.text).toBeUndefined()
  expect(disk.files.get(FILE)).toBe('- older idea\n- Make the timeout configurable\n')
})

test('the capture pane saves each submit, multi-line ones included', async ($, on) => {
  const disk = fakeSession(on)
  await $.session.start({ cwd: '/Users/test/Projects/app', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'idea', args: '', ...RUN })

  for (const surface of ['terminal', 'desktop'] as const) {
    disk.files.clear()
    const ui = await $.ui.mount({ plugin: 'idea-shell', surface, ...CAPTURE })
    await ui.input({ key: 'idea', text: 'Split the importer\nby source', kind: 'submit' })
    await ui.input({ key: 'idea', text: '   ', kind: 'submit' })
    expect(disk.files.get(FILE)).toBe('- Split the importer\n  by source\n')
    expect(await ui.find({ type: 'Text', text: /1 idea for this folder/ })).toBeDefined()
    const lineBreakHint = await ui.find({ type: 'Text', text: /Shift\+Enter adds a line/ })
    if (surface === 'terminal') {
      expect(lineBreakHint).toBeDefined()
    } else {
      expect(lineBreakHint).toBeUndefined()
    }
    await ui.unmount()
  }
})

test('the mobile app, which draws no text field, is pointed to /idea with the text', async ($, on) => {
  fakeSession(on)
  await $.session.start({ cwd: '/Users/test/Projects/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'idea-shell', surface: 'mobile', ...CAPTURE })
  expect(await ui.find({ type: 'Text', text: /\/idea followed by the idea saves it/ })).toBeDefined()
  await ui.unmount()
})

test('/ideas hands an idea to the prompt, and the last removal deletes the file', async ($, on) => {
  const disk = fakeSession(on, { [FILE]: '- first\n- second\n' })
  await $.session.start({ cwd: '/Users/test/Projects/app', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'ideas', args: '', ...RUN })

  const ui = await $.ui.mount({ plugin: 'idea-shell', surface: 'desktop', ...LIST })
  await ui.press({ key: 'work-0' })
  expect(disk.fills).toEqual(['first'])
  expect(disk.closed).toEqual(['ideas'])
  expect(disk.files.get(FILE)).toBe('- second\n')

  await ui.press({ key: 'delete-0' })
  expect(disk.files.has(FILE)).toBe(false)
  expect(await ui.find({ type: 'Text', text: /No ideas for this folder/ })).toBeDefined()
  await ui.unmount()
})

test('Claude lists ideas and removes one by number', async ($, on) => {
  const disk = fakeSession(on, { [FILE]: '- first\n- second\n  details\n' })
  await $.session.start({ cwd: '/Users/test/Projects/app', surface: 'terminal', isInteractive: true })

  const listed = await $.tool.call({ tool: 'mcp__idea-shell__ideas_list' })
  expect(JSON.stringify(listed.result)).toContain('1. first\\n2. second\\n   details')

  const removed = await $.tool.call({ tool: 'mcp__idea-shell__idea_remove', number: 1 })
  expect(JSON.stringify(removed.result)).toContain('Removed: first')
  expect(disk.files.get(FILE)).toBe('- second\n  details\n')

  const missing = await $.tool.call({ tool: 'mcp__idea-shell__idea_remove', number: 5 })
  expect(JSON.stringify(missing.result)).toContain('No idea number 5')
})

test('the footer shows the lightbulb only while ideas exist', async ($, on) => {
  const disk = fakeSession(on, { [FILE]: '- first\n- second\n' })
  await $.session.start({ cwd: '/Users/test/Projects/app', surface: 'terminal', isInteractive: true })

  const terminal = await $.ui.mount({ plugin: 'idea-shell', surface: 'terminal', component: 'SessionMode', props: { modes: ['focus'] } })
  expect(disk.modes.at(-1)).toEqual(['focus', '💡 2'])
  await terminal.unmount()

  const desktop = await $.ui.mount({ plugin: 'idea-shell', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  expect(await desktop.find({ type: 'Text', text: '💡 2' })).toBeDefined()
  await desktop.unmount()

  disk.files.clear()
  await $.command.run({ command: 'ideas', args: '', ...RUN })
  const empty = await $.ui.mount({ plugin: 'idea-shell', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  expect(await empty.find({ type: 'Text', text: /💡/ })).toBeUndefined()
  await empty.unmount()
})
