import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Usage } from '../types'
import { spansOf } from './format'

const REFRESH_MS = 30_000

const usage = atom({ plugin: 'status-band', key: 'usage' } as const, null)

async function isDrawnRemotely($: EngineInterface): Promise<boolean> {
  const surfaces = await $.session.surfaces()

  return surfaces.some(i => i !== 'terminal')
}

async function refresh($: EngineInterface): Promise<void> {
  if (!(await isDrawnRemotely($))) {
    return
  }
  const current = await $.session.usage()
  const windowOf = (kind: string) => current.rateLimits.find(i => i.kind === kind)?.percentUsed ?? null
  const next: Usage = {
    contextPercent: current.context.percent ?? null,
    fiveHourPercent: windowOf('five_hour'),
    sevenDayPercent: windowOf('seven_day'),
  }
  await update($, usage, () => next)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    $.clock.every(REFRESH_MS, () => {
      void refresh($)
    })
    await refresh($)

    return result
  })

  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    await refresh($)

    return result
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      await refresh($)
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($)

    return result
  })

  // The desktop draws the SessionMode labels in the footer under the prompt,
  // beside its model and effort pickers: the one slot with room for a short line.
  // Other mods may draw there too; what they drew beneath stays.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface === 'terminal') {
      return next(e)
    }
    const current = await read($, usage)
    const spans = current === null ? [] : spansOf(current)
    const below = await next(e)
    if (spans.length === 0) {
      return below
    }
    const { Box, Text } = $.ui.resolve(e)
    const modes = e.props.modes.length === 0 ? null : <Text dimColor>{`${e.props.modes.join(' & ')} · `}</Text>

    return (
      <Box flexDirection="row">
        {below.type === 'engine' ? modes : below}
        {below.type === 'engine' ? null : <Text dimColor> · </Text>}
        <Text wrap="truncate-end">
          {spans.map((span, index) => (
            <Text key={`span-${index}`} color={span.color} dimColor={span.isDim}>
              {span.text}
            </Text>
          ))}
        </Text>
      </Box>
    )
  })
}
