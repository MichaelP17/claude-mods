import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { Comparison, Snapshot } from '../types'
import type { HubCall, HubEntry } from './hub'
import { buttonWidthOf, diffCards, headerCard, noticeCard, snapshotCard, spinnerSvg } from './look'
import type { Card } from './look'
import { ROOMY_WIDTH, barCard, cardWidthOf, columnsOf, fieldCard } from './svg'
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

const FIELD_LABEL_WIDTH = 176

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
      const { Input, Svg } = $.ui.resolve(e)
      const width = cardWidthOf(e.props.bodyColumns)
      const newest = [...list].reverse()
      const compared = await read($, comparison)
      const message = await read($, notice)
      const changed = await read($, isChanged)
      const drawCards = (cards: readonly Card[]) => cards.map(card => <Svg source={card.source} alt={card.alt} width={width} height={card.height} />)
      const spinner = (label: string) => (
        <Box flexDirection="row" columnGap={1} alignItems="center">
          <Svg source={spinnerSvg()} alt={label} width={16} height={16} />
          <Text dimColor>{label}</Text>
        </Box>
      )
      const header = headerCard({
        width,
        eyebrow: '📸 CONFIG SNAPSHOTS',
        title: changed === null ? 'Snapshots of ~/.claude' : changed ? 'Changed since the last snapshot' : 'Matches the last snapshot',
        counter: `${list.length} ${list.length === 1 ? 'snapshot' : 'snapshots'}`,
      })

      const isRoomy = width >= ROOMY_WIDTH
      const fieldLabel = 'TAKE A SNAPSHOT'
      const fieldHint = changed === true ? 'Something changed · Enter records it' : 'What it captures · Enter records it'
      const input = (
        <Input
          key="snapshot-name"
          value=""
          placeholder="e.g. Before trying the new plugin"
          submitLabel="Snapshot"
          autoFocus
          onSubmit={label => {
            if (label.trim().length > 0) {
              void takeSnapshot($, label.trim())
            }
          }}
        />
      )
      // The field and the buttons lie over the cards, centered on their height:
      // the pictures take no presses. A narrow pane keeps them beneath.
      const layered = (key: string, list: readonly Card[], buttons: RenderElement[]) =>
        isRoomy ? (
          <Box key={key} flexDirection="column">
            {drawCards(list)}
            <Box position="absolute" top={0} bottom={0} right={2} flexDirection="row" alignItems="center" columnGap={1}>
              {buttons}
            </Box>
          </Box>
        ) : (
          <Box key={key} flexDirection="column" rowGap={1}>
            {drawCards(list)}
            <Box flexDirection="row" columnGap={1}>
              {buttons}
            </Box>
          </Box>
        )

      return (
        <Box flexDirection="column" rowGap={1}>
          {drawCards([header])}
          <Box flexDirection="column" rowGap={isRoomy ? 1 : 0}>
            {isRoomy ? (
              <Box key="take" flexDirection="column">
                {drawCards([fieldCard(width, fieldLabel, fieldHint, FIELD_LABEL_WIDTH)])}
                <Box position="absolute" top={0} bottom={0} left={columnsOf(FIELD_LABEL_WIDTH)} right={2} flexDirection="column" justifyContent="center">
                  {input}
                </Box>
              </Box>
            ) : (
              <Box flexDirection="column">
                <Text bold dimColor>
                  {changed === true ? 'TAKE A SNAPSHOT · SOMETHING CHANGED' : fieldLabel}
                </Text>
                {input}
              </Box>
            )}
            {running && current === null ? spinner('Recording…') : message.length > 0 && <Text dimColor>{message}</Text>}
          </Box>

          {newest.length > 0 && (
            <Text dimColor bold>
              HISTORY · NEWEST FIRST
            </Text>
          )}
          {newest.map(snapshot => {
            const isSelected = snapshot.name === current
            const result = isSelected && compared?.name === snapshot.name ? compared : null
            const labels = isSelected && !armed ? ['⇄ Compare', '↶ Roll back…'] : ['⇄ Compare']
            const card = snapshotCard(width, snapshot, { isSelected, isArmed: armed, reserve: buttonWidthOf(labels) })

            return (
              <Box key={`card-${snapshot.name}`} flexDirection="column" rowGap={1}>
                {layered(`snapshot-${snapshot.name}`, [card], [
                  <Button key={`select-${snapshot.name}`} {...(isSelected ? {} : { dimColor: true })} label="⇄ Compare" onPress={() => selectSnapshot($, snapshot.name)} />,
                  ...(isSelected && !armed ? [<Button key="arm" hover={{ color: 'error' }} label="↶ Roll back…" onPress={() => update($, isArmed, () => true)} />] : []),
                ])}
                {isSelected && running && spinner('Comparing with the current config…')}
                {result !== null &&
                  !running &&
                  (result.text.trim().length === 0 ? (
                    <Text color="success">✓ Nothing changed since this snapshot</Text>
                  ) : (
                    <Box flexDirection="column" rowGap={1}>
                      {layered('diff-bar', [barCard(width, 'What changed', result.isFull ? 'EVERY CHANGE SINCE THIS SNAPSHOT' : 'CHANGED SINCE THIS SNAPSHOT')], [
                        <Button key="full-diff" dimColor label={result.isFull ? 'Show summary' : 'Show full diff'} onPress={() => compare($, snapshot.name, !result.isFull)} />,
                      ])}
                      {drawCards(diffCards(width, result.text, result.text))}
                    </Box>
                  ))}
                {isSelected &&
                  armed &&
                  layered(
                    'rollback',
                    noticeCard(width, 'card-error', `Roll back to ${snapshot.name}?`, 'The current config is replaced by this snapshot. Claude Code loads it after a restart.', isRoomy ? buttonWidthOf(['↶ Roll back', 'Cancel']) : 0),
                    [
                      <Button key="confirm" variant="primary" label="↶ Roll back" onPress={() => rollBack($, snapshot.name)} />,
                      <Button key="cancel" label="Cancel" onPress={() => update($, isArmed, () => false)} />,
                    ],
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
