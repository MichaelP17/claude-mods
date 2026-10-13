import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Comparison, Snapshot } from '../types'
import type { HubCall, HubEntry } from './hub'
import { TONES, dotSvg, spinnerSvg } from './look'
import { hasConfigChanges } from './status'

const PANE = 'config-snapshots'
const SCRIPT_TIMEOUT_MS = 180_000

const snapshots = atom({ plugin: 'config-snapshots', key: 'snapshots' } as const, [])
const selected = atom({ plugin: 'config-snapshots', key: 'selected' } as const, null)
const output = atom({ plugin: 'config-snapshots', key: 'output' } as const, '')
const isArmed = atom({ plugin: 'config-snapshots', key: 'isArmed' } as const, false)
const isBusy = atom({ plugin: 'config-snapshots', key: 'isBusy' } as const, false)
const comparison = atom({ plugin: 'config-snapshots', key: 'comparison' } as const, null)
const notice = atom({ plugin: 'config-snapshots', key: 'notice' } as const, '')
const isChanged = atom({ plugin: 'config-snapshots', key: 'isChanged' } as const, null)

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
  await compare($, name, false)
}

async function compare($: EngineInterface, name: string, isFull: boolean): Promise<void> {
  await update($, selected, () => name)
  await update($, isArmed, () => false)
  await update($, comparison, () => null)
  const text = await busy($, () => runScript($, isFull ? ['diff', name, '--full'] : ['diff', name]))
  const value: Comparison = { name, text, isFull }
  await update($, comparison, () => value)
}

async function rollBack($: EngineInterface, name: string): Promise<void> {
  await update($, isArmed, () => false)
  const text = await busy($, () => runScript($, ['rollback', name]))
  await update($, notice, () => text)
  await refreshSnapshots($)
  await reportStatus($)
  $.ui.toast(`Config rolled back to ${name}. Restart Claude Code to load it.`)
}

async function takeSnapshot($: EngineInterface, label: string): Promise<string> {
  const text = await busy($, () => runScript($, ['snapshot', label]))
  await update($, notice, () => text)
  await refreshSnapshots($)
  await reportStatus($)

  return text
}

// Without mod-hub the call throws; the snapshots stay reachable by command.
async function publish($: EngineInterface, entry: HubEntry): Promise<void> {
  try {
    await ($ as unknown as HubCall).hub.set({ id: 'config-snapshots', ...entry })
  } catch {
    // mod-hub is not loaded.
  }
}

async function reportStatus($: EngineInterface): Promise<boolean> {
  const changed = hasConfigChanges(await runScript($, ['status']))
  await update($, isChanged, () => changed)
  await publish($, {
    icon: '📸',
    title: 'Config snapshots',
    status: changed ? 'Config changed since the last snapshot' : 'Config matches the last snapshot',
    attention: changed ? 'info' : 'none',
    actions: [{ key: 'open', label: 'Open' }],
  })

  return changed
}

async function openSnapshots($: EngineInterface): Promise<void> {
  await update($, notice, () => '')
  await refreshSnapshots($)
  await $.ui.open({ id: PANE, title: 'Config snapshots', focus: true })
  void reportStatus($)
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

    if (await reportStatus($)) {
      $.ui.toast('Claude config changed since the last snapshot. /snapshot <name> records it.')
    }

    return next(e)
  })

  on('command.run', { command: 'snapshot' }, async ($, e) => {
    const label = e.args.trim()
    if (label.length === 0) {
      return { text: 'Usage: /snapshot <name>' }
    }
    const text = await takeSnapshot($, label)

    return { text }
  })

  on('command.run', { command: 'snapshots' }, async $ => {
    await openSnapshots($)

    return {}
  })

  on('ui.press', { plugin: 'mod-hub', element: 'config-snapshots:open' }, async ($, e, next) => {
    await openSnapshots($)

    return next(e)
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
    if (e.surface !== 'terminal' && e.surface !== 'mobile') {
      const { Code, Input, Svg } = $.ui.resolve(e)
      const newest = [...list].reverse()
      const compared = await read($, comparison)
      const message = await read($, notice)
      const changed = await read($, isChanged)
      const spinner = (label: string) => (
        <Box flexDirection="row" columnGap={1} alignItems="center">
          <Svg source={spinnerSvg()} alt={label} width={14} height={14} isInteractive />
          <Text dimColor>{label}</Text>
        </Box>
      )

      return (
        <Box flexDirection="column" rowGap={1}>
          <Box flexDirection="row" justifyContent="space-between" alignItems="flex-end">
            <Box flexDirection="column">
              <Text bold>📸 Config snapshots</Text>
              <Text dimColor>{`${list.length} snapshots of ~/.claude`}</Text>
            </Box>
            {changed !== null && (
              <Text {...(changed ? { color: 'warning' } : { color: 'success' })}>
                {changed ? '● Changed since the last snapshot' : '✓ Matches the last snapshot'}
              </Text>
            )}
          </Box>

          <Box key="take" flexDirection="column" rowGap={1} borderStyle="round" borderColor={changed === true ? 'claude' : undefined} borderDimColor={changed !== true} paddingX={1}>
            <Text bold>Take a snapshot</Text>
            <Input
              key="snapshot-name"
              value=""
              placeholder="What it captures, e.g. Before trying the new plugin"
              submitLabel="Snapshot"
              autoFocus
              onSubmit={label => {
                if (label.trim().length > 0) {
                  void takeSnapshot($, label.trim())
                }
              }}
            />
            {running && selected === null ? spinner('Recording…') : message.length > 0 && <Text dimColor>{message}</Text>}
          </Box>

          {newest.length > 0 && (
            <Text dimColor bold>
              HISTORY · NEWEST FIRST
            </Text>
          )}
          {newest.map(snapshot => {
            const isSelected = snapshot.name === current
            const result = isSelected && compared?.name === snapshot.name ? compared : null

            return (
              <Box
                key={`card-${snapshot.name}`}
                flexDirection="column"
                rowGap={1}
                borderStyle="round"
                {...(isSelected ? { borderColor: armed ? 'error' : 'claude' } : { borderDimColor: true })}
                hover={{ borderColor: armed && isSelected ? 'error' : 'claude', borderDimColor: false }}
                paddingX={1}
              >
                <Box flexDirection="row" columnGap={2} alignItems="center">
                  <Svg source={dotSvg(isSelected ? TONES.accent : TONES.neutral, false)} alt={isSelected ? 'selected' : 'snapshot'} width={14} height={14} />
                  <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                    <Text bold>{snapshot.message.length > 0 ? snapshot.message : snapshot.name}</Text>
                    <Text dimColor>{`${snapshot.createdAt} · ${snapshot.name}`}</Text>
                  </Box>
                  <Box flexDirection="row" columnGap={1}>
                    <Button key={`select-${snapshot.name}`} {...(isSelected ? {} : { dimColor: true })} label="⇄ Compare" onPress={() => selectSnapshot($, snapshot.name)} />
                    {isSelected && !armed && <Button key="arm" hover={{ color: 'error' }} label="↶ Roll back…" onPress={() => update($, isArmed, () => true)} />}
                  </Box>
                </Box>
                {isSelected && running && spinner('Comparing with the current config…')}
                {result !== null && !running && (
                  <Box flexDirection="column" rowGap={1}>
                    {result.text.trim().length === 0 ? (
                      <Text color="success">✓ Nothing changed since this snapshot</Text>
                    ) : (
                      <Box flexDirection="column">
                        <Text dimColor>{result.isFull ? 'Every change since this snapshot' : 'Changed since this snapshot'}</Text>
                        <Code source={result.text} {...(result.isFull ? { language: 'diff' } : {})} wrap="truncate-end" />
                      </Box>
                    )}
                    {result.text.trim().length > 0 && (
                      <Box flexDirection="row">
                        <Button
                          key="full-diff"
                          dimColor
                          label={result.isFull ? 'Show summary' : 'Show full diff'}
                          onPress={() => compare($, snapshot.name, !result.isFull)}
                        />
                      </Box>
                    )}
                  </Box>
                )}
                {isSelected && armed && (
                  <Box flexDirection="column" rowGap={1}>
                    <Text color="error">{`Replace the current config with ${snapshot.name}? Claude Code loads it after a restart.`}</Text>
                    <Box flexDirection="row" columnGap={1}>
                      <Button key="confirm" variant="primary" label={`Roll back to ${snapshot.name}`} onPress={() => rollBack($, snapshot.name)} />
                      <Button key="cancel" label="Cancel" onPress={() => update($, isArmed, () => false)} />
                    </Box>
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
      )
    }

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
