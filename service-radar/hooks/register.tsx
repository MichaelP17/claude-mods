import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Service } from '../types'
import { detectServices, isRunning, mayStopServices } from './detect'

const PANE = 'service-radar'
const STORE_KEY = 'services'
const STOP_ALL = 'Stop all'
const KEEP = 'Keep running'
const CHECK_TIMEOUT_MS = 20_000
const STOP_TIMEOUT_MS = 120_000

const services = atom({ plugin: 'service-radar', key: 'services' } as const, [])
const isBusy = atom({ plugin: 'service-radar', key: 'isBusy' } as const, false)
const message = atom({ plugin: 'service-radar', key: 'message' } as const, '')

// Services outlive the session that started them, so the list lives in the
// plugin's store; the state atom only mirrors it for drawing.
async function loadServices($: EngineInterface): Promise<Service[]> {
  const stored = await $.store.get(STORE_KEY)

  return Array.isArray(stored) ? (stored as Service[]) : []
}

async function saveServices($: EngineInterface, list: Service[]): Promise<void> {
  await $.store.set(STORE_KEY, list)
  await update($, services, () => list)
  $.ui.status(list.length === 0 ? undefined : `services ${list.length}`)
}

// The desktop app starts sessions with launchd's bare PATH, which lacks
// Homebrew: docker, colima and brew would not be found there.
const HOMEBREW_PATH = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin']

async function searchPath($: EngineInterface): Promise<string[]> {
  const current = ((await $.env.get('PATH')) ?? '/usr/bin:/bin:/usr/sbin:/sbin').split(':').filter(i => i !== '')

  return [...current, ...HOMEBREW_PATH.filter(i => !current.includes(i))]
}

// The child's PATH alone may not steer the lookup of argv[0], so the
// executable is resolved here; on any doubt the bare name is passed on.
async function resolveExecutable($: EngineInterface, command: string, directories: readonly string[]): Promise<string> {
  if (command.includes('/')) {
    return command
  }
  for (const directory of directories) {
    try {
      if (await $.fs.exists(`${directory}/${command}`)) {
        return `${directory}/${command}`
      }
    } catch {
      return command
    }
  }

  return command
}

async function runCommand($: EngineInterface, argv: readonly string[], cwd: string, timeoutMs: number) {
  const directories = await searchPath($)
  const [command = '', ...args] = argv
  const executable = await resolveExecutable($, command, directories)

  return $.process.run([executable, ...args], {
    cwd,
    timeoutMs,
    env: { HOMEBREW_NO_AUTO_UPDATE: '1', PATH: directories.join(':') },
  })
}

async function stillRunning($: EngineInterface, service: Service): Promise<boolean> {
  if (service.check === null) {
    return true
  }
  try {
    const result = await runCommand($, service.check.argv, service.cwd, CHECK_TIMEOUT_MS)

    return isRunning(service.check.rule, result.exitCode, result.stdout)
  } catch {
    return false
  }
}

async function refresh($: EngineInterface): Promise<Service[]> {
  const list = await loadServices($)
  const alive: Service[] = []
  for (const service of list) {
    if (await stillRunning($, service)) {
      alive.push(service)
    }
  }
  await saveServices($, alive)

  return alive
}

async function stopService($: EngineInterface, service: Service): Promise<string> {
  try {
    const result = await runCommand($, service.stop, service.cwd, STOP_TIMEOUT_MS)
    if (result.exitCode !== 0 && (await stillRunning($, service))) {
      return `${service.label}: stop failed (${result.stderr.trim().split('\n').pop() ?? `exit ${result.exitCode}`})`
    }
  } catch (error) {
    return `${service.label}: stop failed (${error instanceof Error ? error.message : 'unknown error'})`
  }
  await saveServices($, (await loadServices($)).filter(i => i.id !== service.id))

  return `${service.label}: stopped`
}

async function stopAll($: EngineInterface): Promise<string> {
  const lines: string[] = []
  for (const service of await loadServices($)) {
    lines.push(await stopService($, service))
  }

  return lines.join('\n')
}

async function busy($: EngineInterface, work: () => Promise<string>): Promise<void> {
  if (await read($, isBusy)) {
    return
  }
  await update($, isBusy, () => true)
  try {
    const text = await work()
    await update($, message, () => text)
  } finally {
    await update($, isBusy, () => false)
  }
}

// A press handler runs under Claude Code's 10-second hook budget, and stopping
// a VM takes longer; the work is handed to a timer, which has no such limit.
function inBackground($: EngineInterface, work: () => Promise<string>): void {
  $.clock.after(0, () => {
    void busy($, work)
  })
}

async function forget($: EngineInterface, id: string): Promise<void> {
  await saveServices($, (await loadServices($)).filter(i => i.id !== id))
}

function shortPath(path: string, home: string | undefined): string {
  return home !== undefined && path.startsWith(home) ? `~${path.slice(home.length)}` : path
}

function clockTime(timestamp: number): string {
  const date = new Date(timestamp)

  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'services', description: 'Show the services Claude started and stop them' })
    // Checking services can take seconds (a slow Docker daemon); startup must not wait for it.
    void refresh($).then(alive => {
      if (alive.length > 0) {
        $.ui.toast(`${alive.length} service${alive.length === 1 ? '' : 's'} Claude started earlier still running. /services shows them.`)
      }
    })

    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const cwd = await $.session.cwd()
    const result = await next(e)
    if (result.deny !== undefined || result.isError === true) {
      return result
    }

    const output = typeof result.result.stdout === 'string' ? result.result.stdout : ''
    const home = (await $.env.get('HOME')) ?? ''
    const detected = detectServices(e.command, cwd, home, output)
    if (detected.length > 0) {
      const now = await $.clock.now()
      const list = await loadServices($)
      const added = detected
        .filter(found => !list.some(known => known.label === found.label && known.cwd === found.cwd))
        .map((found, index) => ({ ...found, id: `${now}-${index}`, startedAt: now }))
      await saveServices($, [...list, ...added])
    } else if (mayStopServices(e.command) && (await loadServices($)).length > 0) {
      void refresh($)
    }

    return result
  })

  on('command.run', { command: 'services' }, async $ => {
    await refresh($)
    await update($, message, () => '')
    await $.ui.open({ id: PANE, title: 'Services', focus: true })

    return {}
  })

  // A /clear is the last moment to ask: on exit Claude Code allows no dialog,
  // and the list is kept in the store for the next session instead.
  on('command.run', { command: 'clear' }, async ($, e, next) => {
    const alive = await refresh($)
    if (alive.length === 0) {
      return next(e)
    }
    const names = alive.slice(0, 5).map(i => `- ${i.label}`).join('\n')
    const more = alive.length > 5 ? `\n- and ${alive.length - 5} more` : ''
    let answer = KEEP
    try {
      answer = await $.ui.ask(`Services Claude started are still running:\n${names}${more}\n\nStop them before clearing?`, {
        options: [STOP_ALL, KEEP],
        header: 'Services',
      })
    } catch {
      answer = KEEP
    }
    if (answer === STOP_ALL) {
      $.ui.toast(await stopAll($))
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, services)
    const running = await read($, isBusy)
    const text = await read($, message)
    const home = await $.env.get('HOME')

    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>No services started by Claude are running.</Text>}
        {list.map(service => (
          <Box key={`row-${service.id}`}>
            <Text>
              {service.check === null ? '?' : '●'} {service.label}
            </Text>
            <Text dimColor>
              {'  '}
              {shortPath(service.cwd, home)} · since {clockTime(service.startedAt)}
              {'  '}
            </Text>
            <Button key={`stop-${service.id}`} label="Stop" onPress={() => inBackground($, () => stopService($, service))} />
            {service.check === null && (
              <Button key={`forget-${service.id}`} dimColor label="Forget" onPress={() => forget($, service.id)} />
            )}
          </Box>
        ))}

        {running && <Text dimColor>Working…</Text>}
        {!running && text.length > 0 && (
          <Box marginTop={1}>
            <Text>{text}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          {list.length > 1 && <Button key="stop-all" label="Stop all" onPress={() => inBackground($, () => stopAll($))} />}
          <Button key="refresh" dimColor label="Refresh" onPress={() => inBackground($, async () => `${(await refresh($)).length} running`)} />
          <Button key="close" role="dismiss" dimColor label="Close" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}
