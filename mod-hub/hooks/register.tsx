import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HubEntry } from '../types'
import { badgeOf, entryOf, sorted, upsert, without } from './entries'
import { TONES, dotSvg } from './look'

const PANE = 'hub'
const TITLE = 'Mods'

const entries = atom({ plugin: 'mod-hub', key: 'entries' } as const, [])

const TONE_OF = {
  none: { text: 'inactive', svg: TONES.neutral, alt: 'quiet' },
  info: { text: 'claude', svg: TONES.accent, alt: 'active' },
  warning: { text: 'warning', svg: TONES.warning, alt: 'needs attention' },
} as const

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
    const Svg = 'Svg' in ui ? ui.Svg : null
    const list = sorted(await read($, entries))
    const noted = list.filter(i => i.attention !== 'none')
    const quiet = list.filter(i => i.attention === 'none')

    const drawCard = (entry: HubEntry) => {
      const tone = TONE_OF[entry.attention]

      return (
        <Box
          key={`row-${entry.id}`}
          flexDirection="row"
          columnGap={2}
          alignItems="center"
          borderStyle="round"
          {...(entry.attention === 'warning' ? { borderColor: 'warning' } : { borderDimColor: true })}
          hover={{ borderColor: 'claude', borderDimColor: false }}
          paddingX={1}
        >
          <Text>{entry.icon}</Text>
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Text bold>{entry.title}</Text>
            {entry.status.length > 0 && (
              <Box flexDirection="row" columnGap={1} alignItems="center">
                {Svg === null ? (
                  <Text color={tone.text}>●</Text>
                ) : (
                  <Svg source={dotSvg(tone.svg, entry.attention === 'warning')} alt={tone.alt} width={14} height={14} isInteractive />
                )}
                <Text {...(entry.attention === 'none' ? { dimColor: true } : { color: tone.text })}>{entry.status}</Text>
              </Box>
            )}
          </Box>
          {entry.actions.length > 0 && (
            <Box flexDirection="row" columnGap={1}>
              {entry.actions.map((action, index) => (
                <Button
                  key={`${entry.id}:${action.key}`}
                  label={action.label}
                  {...(index === 0 && entry.attention !== 'none' ? { variant: 'primary' as const } : {})}
                  onPress={() => $.ui.close({ id: PANE })}
                />
              ))}
            </Box>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text bold>🧰 Mods</Text>
          <Text dimColor>{noted.length === 0 ? `${list.length} running · all quiet` : `${noted.length} of ${list.length} need a look`}</Text>
        </Box>
        {list.length === 0 && <Text dimColor>No mod has reported anything yet. Mods show up here once they call $.hub.set.</Text>}
        {noted.length > 0 && (
          <Box flexDirection="column" rowGap={1}>
            <Text dimColor bold>
              NEEDS A LOOK
            </Text>
            {noted.map(drawCard)}
          </Box>
        )}
        {quiet.length > 0 && (
          <Box flexDirection="column" rowGap={1}>
            {noted.length > 0 && (
              <Text dimColor bold>
                ALL QUIET
              </Text>
            )}
            {quiet.map(drawCard)}
          </Box>
        )}
      </Box>
    )
  })
}
