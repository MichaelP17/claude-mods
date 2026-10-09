import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Snapshot } from '../types'
import { hasConfigChanges } from './status'

const PANE = 'config-snapshots'
const SCRIPT_TIMEOUT_MS = 180_000

const snapshots = atom({ plugin: 'config-snapshots', key: 'snapshots' } as const, [])
const selected = atom({ plugin: 'config-snapshots', key: 'selected' } as const, null)
const output = atom({ plugin: 'config-snapshots', key: 'output' } as const, '')
const isArmed = atom({ plugin: 'config-snapshots', key: 'isArmed' } as const, false)
const isBusy = atom({ plugin: 'config-snapshots', key: 'isBusy' } as const, false)

async function runScript($: EngineInterface, args: readonly string[]): Promise<string> {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  // The script ships inside this mod, so the mod works from wherever it was cloned.
  const pluginRoot = $.plugin.root.replace(/[\\/]\.claude-plugin[\\/]?$/, '')
  const script = `${pluginRoot}/bin/claude-config`
  // Windows cannot execute a shell script directly; Git Bash's bash runs it.
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const argv = isWindows ? ['bash', script, ...args] : [script, ...args]
  const result = await $.process.run(argv, {
    cwd: home,
    timeoutMs: SCRIPT_TIMEOUT_MS,
  })
  const text = [result.stdout.trim(), result.stderr.trim()].filter(i => i.length > 0).join('\n')

  return result.exitCode === 0 ? text : `Failed (exit ${result.exitCode}):\n${text}`
}

async function refreshSnapshots($: EngineInterface): Promise<Snapshot[]> {
  const listing = await runScript($, ['list', '--tsv'])
  const list = listing
    .split('\n')
    .filter(i => i.includes('\t'))
    .map(i => {
      const [createdAt = '', name = '', message = ''] = i.split('\t')

      return { createdAt, name, message }
    })
  await update($, snapshots, () => list)

  return list
}

// Every script call goes through here so the pane shows one call at a time and
// a second press cannot start a rollback while a snapshot is still being written.
async function busy($: EngineInterface, work: () => Promise<string>): Promise<string> {
  if (await read($, isBusy)) {
    return 'claude-config is still running.'
  }
  await update($, isBusy, () => true)
  try {
    const text = await work()
    await update($, output, () => text)

    return text
  } finally {
    await update($, isBusy, () => false)
  }
}

async function selectSnapshot($: EngineInterface, name: string): Promise<void> {
  await update($, selected, () => name)
  await update($, isArmed, () => false)
  await busy($, () => runScript($, ['diff', name]))
}

async function rollBack($: EngineInterface, name: string): Promise<void> {
  await update($, isArmed, () => false)
  await busy($, () => runScript($, ['rollback', name]))
  await refreshSnapshots($)
  $.ui.toast(`Config rolled back to ${name}. Restart Claude Code to load it.`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'snapshot',
      description: 'Record the Claude Code config as a named snapshot',
      argumentHint: '<name>',
    })
    await $.command.register({
      name: 'snapshots',
      description: 'Browse config snapshots, show diffs and roll back',
    })
    await $.command.register({
      name: 'rollback',
      description: 'Show what rolling back to a snapshot changes, then confirm',
      argumentHint: '<name>',
    })

    const status = await runScript($, ['status'])
    if (hasConfigChanges(status)) {
      $.ui.toast('Claude config changed since the last snapshot. /snapshot <name> records it.')
    }

    return next(e)
  })

  on('command.run', { command: 'snapshot' }, async ($, e) => {
    const label = e.args.trim()
    if (label.length === 0) {
      return { text: 'Usage: /snapshot <name>' }
    }
    const text = await busy($, () => runScript($, ['snapshot', label]))
    await refreshSnapshots($)

    return { text }
  })

  on('command.run', { command: 'snapshots' }, async $ => {
    await refreshSnapshots($)
    await $.ui.open({ id: PANE, title: 'Config snapshots', focus: true })

    return {}
  })

  on('command.run', { command: 'rollback' }, async ($, e) => {
    const label = e.args.trim()
    const list = await refreshSnapshots($)
    if (label.length === 0) {
      await $.ui.open({ id: PANE, title: 'Config snapshots', focus: true })

      return {}
    }
    const snapshot = list.find(i => i.name === label || i.message === label)
    if (snapshot === undefined) {
      return { text: `Unknown snapshot: ${label}. /snapshots lists them.` }
    }
    await $.ui.open({ id: PANE, title: 'Config snapshots', focus: true })
    await selectSnapshot($, snapshot.name)

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, snapshots)
    const current = await read($, selected)
    const text = await read($, output)
    const armed = await read($, isArmed)
    const running = await read($, isBusy)

    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>No snapshots yet. /snapshot &lt;name&gt; records one.</Text>}
        {[...list].reverse().map(snapshot => (
          <Box key={`row-${snapshot.name}`}>
            <Button
              key={`select-${snapshot.name}`}
              plain
              dimColor={snapshot.name !== current}
              label={`${snapshot.name === current ? '▸' : ' '} ${snapshot.createdAt}  ${snapshot.message}`}
              onPress={() => selectSnapshot($, snapshot.name)}
            />
          </Box>
        ))}

        {current !== null && (
          <Box marginTop={1}>
            {armed ? (
              <Box>
                <Button
                  key="confirm"
                  variant="primary"
                  label={`Confirm rollback to ${current}`}
                  onPress={() => rollBack($, current)}
                />
                <Button key="cancel" label="Cancel" onPress={() => update($, isArmed, () => false)} />
              </Box>
            ) : (
              <Button
                key="arm"
                label={`Roll back to ${current}`}
                onPress={() => update($, isArmed, () => true)}
              />
            )}
          </Box>
        )}

        {running && <Text dimColor>Running claude-config…</Text>}
        {!running && text.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text>{text}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Button key="close" role="dismiss" dimColor label="Close" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}
