import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

function fakeSession(on: On, runs: string[][], toasts: string[]) {
  mock.clock(on)
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.messages', () => ({ value: [] }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1000, window: 1_000_000, percent: 0 }, rateLimits: [] } }))
  on('fs.exists', (_$, e) => ({ value: e.path === '/usr/bin/security' }))
  on('fs.write', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    runs.push([...e.argv])

    return { value: { exitCode: 0, stdout: 'test-key\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

test('without the variable the key comes from the Keychain item', async ($, on) => {
  const runs: string[][] = []
  const toasts: string[] = []
  mock.env(on, { HOME: '/Users/test' })
  fakeSession(on, runs, toasts)

  await $.command.run({ command: 'jev-preview', args: '', ...RUN })
  expect(runs).toContainEqual(['/usr/bin/security', 'find-generic-password', '-s', 'openrouter-api-key', '-w'])
  expect(toasts.some(i => i.includes('is not set'))).toBe(false)
})

test('the variable wins over the Keychain', async ($, on) => {
  const runs: string[][] = []
  const toasts: string[] = []
  mock.env(on, { HOME: '/Users/test', OPENROUTER_API_KEY: 'from-env' })
  fakeSession(on, runs, toasts)

  await $.command.run({ command: 'jev-preview', args: '', ...RUN })
  expect(runs).toEqual([])
})
