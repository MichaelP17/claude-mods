import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { HubEntry } from '../types'
import { badgeOf, entryOf, sorted, upsert, without } from './entries'
import { buttonWidthOf, entryCard, headerCard } from './look'
import { cardWidthOf } from './svg'

const PANE = 'hub'
const TITLE = 'Mods'

const entries = atom({ plugin: 'mod-hub', key: 'entries' } as const, [])

async function openPane($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })
}

export const register: Register = on => {
  // The methods only raise their events; the hooks below answer them with this
  // mod's own `$`, which an engine.create step does not have.
  on('engine.create', async (_$, e, next) => {
    const built = await next(e)

    return {
      ...built,
      hub: {
        set: async () => undefined,
        remove: async () => undefined,
      },
    }
  })

  on('hub.set', async ($, e) => {
    const entry = entryOf(e)
    await update($, entries, list => upsert(list, entry))

    return { value: undefined }
  })

  on('hub.remove', async ($, e) => {
    await update($, entries, list => without(list, e.id))

    return { value: undefined }
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'hub',
      description: 'Show what every mod reports and open their panes',
      immediate: true,
    })

    return next(e)
  })

  on('command.run', { command: 'hub' }, async $ => {
    await openPane($)

    return {}
  })

  // The desktop app holds a slash command typed mid-turn until the turn ends; a
  // press on this button reaches the mod at once. The terminal keeps the mods'
  // own labels and /hub.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface === 'terminal') {
      return next(e)
    }
    const below = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const badge = badgeOf(await read($, entries))
    const rest = below.type !== 'engine' ? below : e.props.modes.length === 0 ? null : <Text dimColor>{e.props.modes.join(' & ')}</Text>

    return (
      <Box flexDirection="row" alignItems="center">
        <Button key="open-hub" onPress={() => openPane($)}>
          {'🧰'}
          {badge.count > 0 && <Text color={badge.color}>{` ${badge.count}`}</Text>}
        </Button>
        {rest}
      </Box>
    )
  })

  // Each action is pressed as `<mod>:<action>`; the mod hooks `ui.press` on
  // that element and does the work, then this closure closes the hub.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const list = sorted(await read($, entries))
    const noted = list.filter(i => i.attention !== 'none')
    const quiet = list.filter(i => i.attention === 'none')
    const summary = noted.length === 0 ? `${list.length} running · all quiet` : `${noted.length} of ${list.length} need a look`
    const actionsOf = (entry: HubEntry) =>
      entry.actions.map((action, index) => (
        <Button
          key={`${entry.id}:${action.key}`}
          label={action.label}
          {...(index === 0 && entry.attention !== 'none' ? { variant: 'primary' as const } : {})}
          onPress={() => $.ui.close({ id: PANE })}
        />
      ))
    const section = (label: string, group: readonly HubEntry[], draw: (entry: HubEntry) => RenderElement) =>
      group.length > 0 && (
        <Box flexDirection="column" rowGap={1}>
          {noted.length > 0 && (
            <Text dimColor bold>
              {label}
            </Text>
          )}
          {group.map(draw)}
        </Box>
      )

    if (e.surface !== 'terminal') {
      const { Svg } = $.ui.resolve(e)
      const width = cardWidthOf(e.props.bodyColumns)
      const header = headerCard({ width, eyebrow: '🧰 MODS', title: list.length === 0 ? 'Nothing reported yet' : summary, counter: `${list.length} loaded` })
      // The actions lie over the card's right edge: the picture takes no presses.
      const drawCard = (entry: HubEntry) => {
        const card = entryCard(width, entry, buttonWidthOf(entry.actions.map(i => i.label)))

        return (
          <Box key={`row-${entry.id}`} flexDirection="column">
            <Svg source={card.source} alt={card.alt} width={width} height={card.height} />
            {entry.actions.length > 0 && (
              <Box position="absolute" top={0} bottom={0} right={2} flexDirection="row" alignItems="center" columnGap={1}>
                {actionsOf(entry)}
              </Box>
            )}
          </Box>
        )
      }

      return (
        <Box flexDirection="column" rowGap={1}>
          <Svg source={header.source} alt={header.alt} width={width} height={header.height} />
          {list.length === 0 && <Text dimColor>No mod has reported anything yet. Mods show up here once they call $.hub.set.</Text>}
          {section('NEEDS A LOOK', noted, drawCard)}
          {section('ALL QUIET', quiet, drawCard)}
        </Box>
      )
    }

    const drawRow = (entry: HubEntry) => (
      <Box key={`row-${entry.id}`} flexDirection="row" columnGap={1}>
        <Text>{entry.icon}</Text>
        <Text bold>{entry.title}</Text>
        <Text {...(entry.attention === 'none' ? { dimColor: true } : { color: entry.attention === 'warning' ? 'warning' : 'claude' })}>{entry.status}</Text>
        {actionsOf(entry)}
      </Box>
    )

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold>🧰 Mods</Text>
          <Text dimColor>{summary}</Text>
        </Box>
        {list.length === 0 && <Text dimColor>No mod has reported anything yet. Mods show up here once they call $.hub.set.</Text>}
        {section('NEEDS A LOOK', noted, drawRow)}
        {section('ALL QUIET', quiet, drawRow)}
      </Box>
    )
  })
}
