import { describe, expect, test } from 'claude-code/testing'

import { detectServices, isRunning, mayStopServices, resolvePath } from './detect'

const HOME = '/Users/test'

describe('detectServices', () => {
  test('docker compose up -d after cd, with file and project flags', () => {
    const [found] = detectServices('cd app && docker compose -f compose.dev.yml -p shop up -d --build', '/repo', HOME, '')
    expect(found).toEqual({
      label: 'docker compose: shop',
      cwd: '/repo/app',
      stop: ['docker', 'compose', '-f', 'compose.dev.yml', '-p', 'shop', 'down'],
      check: { argv: ['docker', 'compose', '-f', 'compose.dev.yml', '-p', 'shop', 'ps', '--status', 'running', '-q'], rule: 'output' },
    })
  })

  test('docker compose up without -d is not a detached service', () => {
    expect(detectServices('docker compose up', '/repo', HOME, '')).toEqual([])
  })

  test('docker run -d with a name', () => {
    const [found] = detectServices('docker run -d --name pg -p 5432:5432 postgres:18', '/repo', HOME, '')
    expect(found?.stop).toEqual(['docker', 'stop', 'pg'])
    expect(found?.check?.argv).toEqual(['docker', 'ps', '-q', '--filter', 'name=^pg$'])
  })

  test('docker run -d without a name takes the id from the output', () => {
    const id = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6abcd'
    const [found] = detectServices('docker run -d redis', '/repo', HOME, `${id}\n`)
    expect(found?.stop).toEqual(['docker', 'stop', 'a1b2c3d4e5f6'])
  })

  test('colima with and without profile', () => {
    expect(detectServices('colima start', '/repo', HOME, '')[0]?.stop).toEqual(['colima', 'stop'])
    expect(detectServices('colima start --profile work --cpu 4', '/repo', HOME, '')[0]?.stop).toEqual(['colima', 'stop', 'work'])
  })

  test('brew services start, also behind sudo', () => {
    const [found] = detectServices('sudo brew services start postgresql@18', '/repo', HOME, '')
    expect(found?.label).toBe('brew service: postgresql@18')
    expect(found?.stop).toEqual(['brew', 'services', 'stop', 'postgresql@18'])
  })

  test('launchctl load has no check and resolves ~', () => {
    const [found] = detectServices('launchctl load -w ~/Library/LaunchAgents/dev.plist', '/repo', HOME, '')
    expect(found?.stop).toEqual(['launchctl', 'unload', '/Users/test/Library/LaunchAgents/dev.plist'])
    expect(found?.check).toBeNull()
  })

  test('commands written into a file through a heredoc are ignored', () => {
    expect(detectServices("cat > notes.md <<'EOF'\ndocker compose up -d\ncolima start\nEOF", '/repo', HOME, '')).toEqual([])
  })

  test('a heredoc fed to a shell is still read', () => {
    expect(detectServices("bash <<'EOF'\ncolima start\nEOF", '/repo', HOME, '')[0]?.stop).toEqual(['colima', 'stop'])
  })

  test('ordinary commands are ignored', () => {
    expect(detectServices('docker ps && colima status && npm test', '/repo', HOME, '')).toEqual([])
  })
})

describe('resolvePath', () => {
  test('relative, parent and home paths', () => {
    expect(resolvePath('/repo/app', '../api', HOME)).toBe('/repo/api')
    expect(resolvePath('/repo', '~/x', HOME)).toBe('/Users/test/x')
    expect(resolvePath('/repo', '/abs', HOME)).toBe('/abs')
  })
})

describe('isRunning', () => {
  test('reads the brew services JSON', () => {
    expect(isRunning('brew', 0, '[{"name":"postgresql@18","running":true}]')).toBe(true)
    expect(isRunning('brew', 0, '[{"name":"postgresql@18","running":false}]')).toBe(false)
  })

  test('output rule needs output', () => {
    expect(isRunning('output', 0, 'abc\n')).toBe(true)
    expect(isRunning('output', 0, '')).toBe(false)
  })
})

describe('mayStopServices', () => {
  test('recognises stop commands', () => {
    expect(mayStopServices('docker compose down')).toBe(true)
    expect(mayStopServices('colima stop')).toBe(true)
    expect(mayStopServices('git status')).toBe(false)
  })
})
