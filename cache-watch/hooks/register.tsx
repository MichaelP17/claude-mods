import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { CacheReading } from '../types'
import {
  HANDOFF_FILE,
  HANDOFF_PROMPT,
  contextTokensOf,
  footerOf,
  formatRemaining,
  formatTokens,
  handoffContextOf,
  hubStatusOf,
  isCold,
  isMilestoneCommand,
  learnTtl,
  remainingMs,
} from './cache'
import type { HubCall, HubEntry } from './hub'
import { TONES, ringSvg } from './look'

const COMPACT_FIRST = 'Compact first'
const SEND_AS_IS = 'Send as is'
const EXPIRING_COLOR = '#d4a017'

const BAND_TEXT = {
  expiring: { title: '⏳ Cache expires soon', hint: 'compacting now is cheaper than after it expires' },
  milestone: { title: '🏁 Milestone reached', hint: 'a good moment to compact' },
}

const INITIAL: CacheReading = { lastRequestAt: null, ttlMs: 60 * 60 * 1000, contextTokens: 0, isRebuildPending: false }

const reading = atom({ plugin: 'cache-watch', key: 'reading' } as const, INITIAL)
const suggestion = atom({ plugin: 'cache-watch', key: 'suggestion' } as const, null)
const warnedFor = atom({ plugin: 'cache-watch', key: 'warnedFor' } as const, null)
const isWorking = atom({ plugin: 'cache-watch', key: 'isWorking' } as const, false)
const footer = atom({ plugin: 'cache-watch', key: 'footer' } as const, null)
const isHubbed = atom({ plugin: 'cache-watch', key: 'isHubbed' } as const, false)

// Set from the plugin's options when the module registers.
let settings = { ttlMs: 60 * 60 * 1000, warnMs: 10 * 60 * 1000, largeContextTokens: 300_000, statusFromTokens: 300_000 }
let hadMilestone = false
let ticker: Timer | undefined
let published: string | null = null

// Without mod-hub the call throws, and the mod keeps its own footer countdown.
async function publish($: EngineInterface, entry: HubEntry): Promise<void> {
  const text = JSON.stringify(entry)
  if (text === published) {
    return
  }
  let isReached = true
  try {
    await ($ as unknown as HubCall).hub.set({ id: 'cache-watch', ...entry })
  } catch {
    isReached = false
  }
  published = isReached ? text : null
  if ((await read($, isHubbed)) !== isReached) {
    await update($, isHubbed, () => isReached)
  }
}

// Written only on a change, so the ticker does not redraw the footer every
// fifteen seconds for a minute count that stayed the same.
async function refreshFooter($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const visibility = { fromTokens: settings.statusFromTokens, warnMs: settings.warnMs }
  const next = footerOf(await read($, reading), now, visibility)
  const current = await read($, footer)
  if (next?.label !== current?.label || next?.isExpiring !== current?.isExpiring) {
    await update($, footer, () => next)
  }
  const canCompact = (await read($, suggestion)) !== null && !(await read($, isWorking))
  await publish($, {
    icon: '⏳',
    title: 'Cache',
    status: hubStatusOf(await read($, reading), now),
    attention: next?.isExpiring === true ? 'warning' : 'none',
    actions: canCompact ? [{ key: 'compact', label: 'Compact now' }] : [],
  })
}

async function checkExpiring($: EngineInterface): Promise<void> {
  if (await read($, isWorking)) {
    return
  }
  const now = await $.clock.now()
  const current = await read($, reading)
  const remaining = remainingMs(current, now)
  if (remaining === null || remaining === 0 || remaining > settings.warnMs || current.isRebuildPending) {
    return
  }
  if (current.contextTokens < settings.largeContextTokens) {
    return
  }
  if ((await read($, warnedFor)) === current.lastRequestAt) {
    return
  }
  await update($, warnedFor, () => current.lastRequestAt)
  await update($, suggestion, () => ({ kind: 'expiring', contextTokens: current.contextTokens }))
  $.ui.toast(`Prompt cache expires in ${formatRemaining(remaining)} · context ${formatTokens(current.contextTokens)}`, {
    timeoutMs: 10_000,
  })
}

async function tick($: EngineInterface): Promise<void> {
  await refreshFooter($)
  await checkExpiring($)
}

async function markCompacted($: EngineInterface, tokensAfter: number | undefined): Promise<void> {
  await update($, reading, current => ({
    ...current,
    contextTokens: tokensAfter ?? current.contextTokens,
    isRebuildPending: true,
  }))
  await update($, suggestion, () => null)
  await refreshFooter($)
}

async function compactNow($: EngineInterface): Promise<void> {
  await update($, suggestion, () => null)
  const result = await $.session.compact()
  if (result.skip === undefined) {
    await markCompacted($, result.tokensAfter)
  }
}

// The handoff sits at the repository root, so a session started in a
// subfolder still finds it.
async function handoffPathOf($: EngineInterface): Promise<string | null> {
  let directory = await $.session.cwd()
  while (true) {
    const candidate = `${directory}/${HANDOFF_FILE}`
    if (await $.fs.exists(candidate)) {
      return candidate
    }
    const parent = directory.slice(0, directory.lastIndexOf('/'))
    if ((await $.fs.exists(`${directory}/.git`)) || parent.length === 0 || parent === directory) {
      return null
    }
    directory = parent
  }
}

export const register: Register = (on, options) => {
  settings = {
    ttlMs: Number(options.ttlMinutes ?? 60) * 60_000,
    warnMs: Number(options.warnMinutes ?? 10) * 60_000,
    largeContextTokens: Number(options.largeContextTokens ?? 300_000),
    statusFromTokens: Number(options.statusFromTokens ?? 300_000),
  }

  on('session.start', async ($, e, next) => {
    ticker?.cancel()
    ticker = $.clock.every(15_000, () => {
      void tick($)
    })
    await refreshFooter($)

    return next(e)
  })

  on('prompt.context', async ($, e, next) => {
    const result = await next(e)
    const path = await handoffPathOf($)
    if (path === null) {
      return result
    }
    $.ui.toast(`Handoff ready: ${path}`, { timeoutMs: 10_000 })

    return { ...result, blocks: [...result.blocks, { name: 'handoff', text: handoffContextOf(path) }] }
  })

  // Every model request of the main conversation reads the cache and starts
  // its lifetime over. The lifetime counts from the request's start.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      return yield* next(e)
    }
    const startedAt = await $.clock.now()
    const result = yield* next(e)
    const usage = result.usage
    if (usage !== null) {
      await update($, reading, current => ({
        lastRequestAt: startedAt,
        ttlMs: learnTtl(current, startedAt, usage, settings.ttlMs),
        contextTokens: contextTokensOf(usage),
        isRebuildPending: false,
      }))
      await refreshFooter($)
    }

    return result
  })

  on('turn.start', async ($, e, next) => {
    hadMilestone = false
    await update($, isWorking, () => true)

    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && typeof e.command === 'string' && isMilestoneCommand(e.command)) {
      hadMilestone = true
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await update($, isWorking, () => false)
    const current = await read($, reading)
    const now = await $.clock.now()
    if (hadMilestone && current.contextTokens >= settings.largeContextTokens && !isCold(current, now)) {
      await update($, suggestion, () => ({ kind: 'milestone', contextTokens: current.contextTokens }))
    }
    hadMilestone = false
    await refreshFooter($)

    return result
  })

  // On a cold cache the next request re-reads the whole context at the write
  // price anyway. Compacting first means paying that price on the small
  // remainder instead.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer' || e.turnId !== undefined || e.text.trimStart().startsWith('/')) {
      return next(e)
    }
    await update($, suggestion, () => null)
    const current = await read($, reading)
    const now = await $.clock.now()
    if (current.isRebuildPending || !isCold(current, now) || current.contextTokens < settings.largeContextTokens) {
      return next(e)
    }
    let answer: string
    try {
      answer = await $.ui.ask(
        `The prompt cache has expired and the context holds ${formatTokens(current.contextTokens)} tokens. Sending now re-reads all of it at the cache write price. Compact before sending?`,
        { options: [COMPACT_FIRST, SEND_AS_IS], header: 'Cache' },
      )
    } catch {
      answer = SEND_AS_IS
    }
    if (answer === COMPACT_FIRST) {
      try {
        await compactNow($)
      } catch (error) {
        $.ui.toast(`Compaction failed, sending as is: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    return next(e)
  })

  // Catches /compact and automatic compactions. A compaction another plugin
  // answers without passing on is not seen here; the next request's usage
  // corrects the reading then.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && result.skip === undefined) {
      await markCompacted($, result.tokensAfter)
    }

    return result
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, reading, current => ({ ...INITIAL, ttlMs: current.ttlMs }))
      await update($, suggestion, () => null)
      await update($, warnedFor, () => null)
      await update($, footer, () => null)
    }

    return next(e)
  })

  // The terminal draws the mode labels itself, so the countdown joins them
  // there. On the desktop, status-band draws the footer from the labels it was
  // handed, whichever order the mods load in; only a drawn tree survives that.
  // Offered only between turns, as the band above the prompt does.
  on('ui.press', { plugin: 'mod-hub', element: 'cache-watch:compact' }, async ($, e, next) => {
    if (await read($, isWorking)) {
      $.ui.toast('Claude is working; compact once the turn is done.')
    } else {
      void compactNow($)
    }

    return next(e)
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const current = await read($, footer)
    if (current === null) {
      return next(e)
    }
    if (e.surface === 'terminal') {
      return next({ ...e, props: { ...e.props, modes: [...e.props.modes, current.label] } })
    }
    if (await read($, isHubbed)) {
      return next(e)
    }
    const below = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const rest = below.type !== 'engine' ? below : e.props.modes.length === 0 ? null : <Text dimColor>{e.props.modes.join(' & ')}</Text>
    const tone = current.isExpiring ? { color: EXPIRING_COLOR } : { dimColor: true }

    return (
      <Box flexDirection="row">
        <Text {...tone}>{current.label}</Text>
        {rest !== null && <Text dimColor> · </Text>}
        {rest}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, suggestion)
    if (current === null || e.props.hasSurvey || e.props.isWorking) {
      return next(e)
    }
    // Another mod's band (session-relay) may be drawn beneath; it stays under
    // this one. An `engine` element means none was, and it cannot be nested.
    const below = await next(e)
    const beneath = below.type === 'engine' ? null : below
    const { Box, Button, Text } = $.ui.resolve(e)
    const text = BAND_TEXT[current.kind]
    const writeHandoff = async () => {
      await update($, suggestion, () => null)
      await $.prompt.submit({ text: HANDOFF_PROMPT })
    }
    if (e.surface !== 'terminal' && e.surface !== 'mobile') {
      const { Svg } = $.ui.resolve(e)
      const now = await $.clock.now()
      const cache = await read($, reading)
      const remaining = remainingMs(cache, now) ?? 0
      const color = current.kind === 'expiring' ? TONES.warning : TONES.accent

      return (
        <Box flexDirection="column">
          <Box
            key="cache-band"
            flexDirection="row"
            columnGap={2}
            alignItems="center"
            borderStyle="round"
            borderColor={current.kind === 'expiring' ? 'warning' : 'claude'}
            paddingX={1}
          >
            <Svg
              source={ringSvg(remaining / cache.ttlMs, remaining === 0 ? 'cold' : formatRemaining(remaining), color)}
              alt={remaining === 0 ? 'cache is cold' : `cache warm for ${formatRemaining(remaining)}`}
              width={40}
              height={40}
            />
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              <Text bold>{text.title}</Text>
              <Text dimColor>{`${formatTokens(current.contextTokens)} context · ${text.hint}`}</Text>
            </Box>
            <Box flexDirection="row" columnGap={1}>
              <Button key="compact" label="Compact" hotkey="c" variant="primary" onPress={() => compactNow($)} />
              <Button key="handoff" label="Write handoff" hotkey="h" onPress={writeHandoff} />
              <Button key="dismiss" label="Dismiss" hotkey="d" role="dismiss" onPress={() => update($, suggestion, () => null)} />
            </Box>
          </Box>
          {beneath}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={3}>
          <Text>
            <Text bold>{text.title}</Text>
            <Text dimColor>{` · ${formatTokens(current.contextTokens)} context · ${text.hint}`}</Text>
          </Text>
          <Box flexDirection="row" columnGap={1}>
            <Button key="compact" label="Compact" hotkey="c" variant="primary" onPress={() => compactNow($)} />
            <Button key="handoff" label="Write handoff" hotkey="h" onPress={writeHandoff} />
            <Button key="dismiss" label="Dismiss" hotkey="d" role="dismiss" onPress={() => update($, suggestion, () => null)} />
          </Box>
        </Box>
        {beneath}
      </Box>
    )
  })
}
