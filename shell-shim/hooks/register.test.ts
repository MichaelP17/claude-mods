import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const SNAPSHOTS = '/Users/test/.claude/shell-snapshots'
const BASH_OK = { result: { stdout: 'ran', stderr: '', interrupted: false } }

function fakeShell(on: On, snapshots: readonly string[], probeOutput: string) {
  const ran: string[] = []
  const probes: string[][] = []
  mock.env(on, { HOME: '/Users/test' })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('fs.exists', (_$, e) => ({ value: snapshots.length > 0 && e.path === SNAPSHOTS }))
  on('fs.list', () => ({
    value: snapshots.map((name, index) => ({ name, kind: 'file', size: 1, mtimeMs: index + 1, isLink: false })),
  }))
  on('process.run', (_$, e) => {
    probes.push([...e.argv])

    return { value: { exitCode: 0, stdout: probeOutput, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.log', () => ({ value: undefined }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    ran.push(e.command)

    return BASH_OK
  })

  return { ran, probes }
}

test('a zsh session runs the fixed command, probing the newest snapshot once', async ($, on) => {
  const { ran, probes } = fakeShell(on, ['snapshot-zsh-1-old.sh', 'snapshot-zsh-2-new.sh'], 'timeout:\nalias:ls\nshadow:ls\n')
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  await $.tool.call({ tool: 'Bash', command: 'ls -t | head -1' })
  await $.tool.call({ tool: 'Bash', command: 'echo ====' })
  await $.tool.call({ tool: 'Bash', command: 'git status' })

  expect(ran).toEqual(['\\ls -t | head -1', 'setopt no_equals 2>/dev/null; echo ====', 'git status'])
  expect(probes).toHaveLength(1)
  expect(probes[0]?.slice(0, 2)).toEqual(['/bin/zsh', '-fc'])
  expect(probes[0]?.at(-1)).toBe(`${SNAPSHOTS}/snapshot-zsh-2-new.sh`)
})

test('without a zsh snapshot every command runs as written and nothing is probed', async ($, on) => {
  const { ran, probes } = fakeShell(on, ['snapshot-bash-3.sh'], 'timeout:\nalias:ls\nshadow:ls\n')
  await $.tool.call({ tool: 'Bash', command: 'echo ==== ; ls *.x' })

  expect(ran).toEqual(['echo ==== ; ls *.x'])
  expect(probes).toEqual([])
})

test('a failed probe leaves commands untouched', async ($, on) => {
  const { ran } = fakeShell(on, ['snapshot-zsh-4-broken.sh'], 'zsh: something went wrong')
  await $.tool.call({ tool: 'Bash', command: 'echo ====' })

  expect(ran).toEqual(['echo ===='])
})
