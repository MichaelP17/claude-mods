import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Answer, Link, Presence, Task } from '../types'
import {
  USAGE,
  channelOf,
  folderNameOf,
  formatChars,
  forwardTextOf,
  isAnswer,
  isLink,
  isOnline,
  isPresence,
  isTask,
  newId,
  parseCommand,
  previewOf,
  promptBlocksOf,
  statusOf,
} from './relay'

const PANE = 'relay'
const LINK_PREFIX = 'link:'
const POLL_MS = 2_000
const HEARTBEAT_MS = 30_000
const MAX_ANSWER_CHARS = 100_000
const MAX_ANSWERS = 10

const link = atom({ plugin: 'session-relay', key: 'link' } as const, null)
const tasks = atom({ plugin: 'session-relay', key: 'tasks' } as const, [])
const answers = atom({ plugin: 'session-relay', key: 'answers' } as const, [])
const offer = atom({ plugin: 'session-relay', key: 'offer' } as const, null)
const isAttached = atom({ plugin: 'session-relay', key: 'isAttached' } as const, false)
const presence = atom({ plugin: 'session-relay', key: 'presence' } as const, null)
const isActive = atom({ plugin: 'session-relay', key: 'isActive' } as const, false)

// Set from the plugin's options when the module registers.
let settings = { minPromptChars: 300, isNotifying: true }
let poller: Timer | undefined
let isPolling = false
let isFirstPoll = true
let lastHeartbeatAt = 0
let lastStatus: string | undefined
const announced = new Set<string>()
// Answers can be long and are re-listed every poll; a file's content never
// changes once written, so each is read once.
const fileCache = new Map<string, unknown>()

type ChannelPaths = { toWorker: string; toLead: string; presence: string }

async function relayDirectory($: EngineInterface): Promise<string> {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  const configDirectory = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`

  return `${configDirectory}/relay`
}

async function pathsOf($: EngineInterface, channel: string): Promise<ChannelPaths> {
  const base = `${await relayDirectory($)}/${channel}`

  return { toWorker: `${base}/to-worker`, toLead: `${base}/to-lead`, presence: `${base}/worker.json` }
}

async function readJson($: EngineInterface, path: string): Promise<unknown> {
  try {
    if (!(await $.fs.exists(path))) {
      return undefined
    }

    return JSON.parse(await $.fs.read(path)) as unknown
  } catch {
    return undefined
  }
}

async function readInbox<T extends { id: string }>(
  $: EngineInterface,
  directory: string,
  isValid: (value: unknown) => value is T,
): Promise<T[]> {
  if (!(await $.fs.exists(directory))) {
    return []
  }
  const entries = await $.fs.list(directory)
  const names = entries
    .filter(i => i.kind === 'file' && i.name.endsWith('.json'))
    .map(i => i.name)
    .sort()
  const items: T[] = []
  for (const name of names) {
    const path = `${directory}/${name}`
    const value = fileCache.has(path) ? fileCache.get(path) : await readJson($, path)
    if (isValid(value) && `${value.id}.json` === name) {
      fileCache.set(path, value)
      items.push(value)
    }
  }

  return items
}

async function writeItem($: EngineInterface, directory: string, item: { id: string }): Promise<void> {
  await $.fs.write(`${directory}/${item.id}.json`, JSON.stringify(item))
}

async function removeItems($: EngineInterface, directory: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) {
    return
  }
  const paths = ids.map(i => `${directory}/${i}.json`)
  paths.forEach(i => fileCache.delete(i))
  await $.process.run(['rm', '-f', ...paths])
}

async function readPresence($: EngineInterface, channel: string): Promise<Presence | null> {
  const value = await readJson($, (await pathsOf($, channel)).presence)

  return isPresence(value) ? value : null
}

async function writePresence($: EngineInterface, channel: string, busySince: number | null): Promise<void> {
  const now = await $.clock.now()
  const value: Presence = { sessionId: await $.session.id(), busySince, seenAt: now }
  await $.fs.write((await pathsOf($, channel)).presence, JSON.stringify(value))
  lastHeartbeatAt = now
  await update($, presence, () => value)
  await update($, isActive, () => true)
}

// The worker of a channel is the session in its folder that was used last: a
// prompt there or an explicit /relay worker takes the slot over, a session that
// merely starts takes it only while no other worker is alive.
async function claim($: EngineInterface, current: Link, isForced: boolean, busySince?: number | null): Promise<void> {
  const held = await readPresence($, current.channel)
  const now = await $.clock.now()
  const sessionId = await $.session.id()
  const isMine = held?.sessionId === sessionId
  if (!isForced && !isMine && isOnline(held, now)) {
    await update($, presence, () => held)
    await update($, isActive, () => false)
    return
  }
  await writePresence($, current.channel, busySince !== undefined ? busySince : isMine ? held.busySince : null)
}

async function refreshStatus($: EngineInterface): Promise<void> {
  const current = await read($, link)
  const text =
    current === null
      ? undefined
      : statusOf({
          link: current,
          presence: await read($, presence),
          answers: await read($, answers),
          tasks: await read($, tasks),
          isAttached: await read($, isAttached),
          isActive: await read($, isActive),
          now: await $.clock.now(),
        })
  if (text !== lastStatus) {
    lastStatus = text
    $.ui.status(text)
  }
}

async function announceAnswers($: EngineInterface, current: Link, items: readonly Answer[], isQuiet: boolean): Promise<void> {
  const fresh = items.filter(i => !announced.has(i.id))
  const latest = fresh.at(-1)
  if (latest === undefined) {
    return
  }
  fresh.forEach(i => announced.add(i.id))
  const count = items.length === 1 ? '' : ` (${items.length} waiting)`
  $.ui.toast(`${current.channel} answered${count}: ${previewOf(latest.text)}`, { timeoutMs: 10_000 })
  if (!isQuiet && settings.isNotifying) {
    await $.ui.notify(previewOf(latest.text, 120), { title: `${current.channel} finished` }).catch(() => undefined)
  }
}

function announceTasks($: EngineInterface, items: readonly Task[]): void {
  const fresh = items.filter(i => !announced.has(i.id))
  const latest = fresh.at(-1)
  if (latest === undefined) {
    return
  }
  fresh.forEach(i => announced.add(i.id))
  $.ui.toast(`Task from the lead: ${previewOf(latest.text)}`, { timeoutMs: 10_000 })
}

async function pollLead($: EngineInterface, current: Link, paths: ChannelPaths): Promise<void> {
  const items = await readInbox($, paths.toLead, isAnswer)
  await update($, answers, () => items)
  if (items.length === 0) {
    await update($, isAttached, () => false)
  }
  await announceAnswers($, current, items, isFirstPoll)
  const held = await readPresence($, current.channel)
  await update($, presence, () => held)
}

async function pollWorker($: EngineInterface, current: Link, paths: ChannelPaths): Promise<void> {
  const held = await readPresence($, current.channel)
  const now = await $.clock.now()
  const isMine = held !== null && held.sessionId === (await $.session.id())
  if (isMine && now - lastHeartbeatAt >= HEARTBEAT_MS) {
    await writePresence($, current.channel, held.busySince)
  } else if (!isMine && !isOnline(held, now)) {
    await writePresence($, current.channel, null)
  } else if (!isMine) {
    await update($, presence, () => held)
    await update($, isActive, () => false)
  }
  const items = await readInbox($, paths.toWorker, isTask)
  await update($, tasks, () => items)
  if (await read($, isActive)) {
    announceTasks($, items)
  }
}

async function poll($: EngineInterface): Promise<void> {
  const current = await read($, link)
  if (current === null || isPolling) {
    return
  }
  isPolling = true
  try {
    const paths = await pathsOf($, current.channel)
    if (current.role === 'lead') {
      await pollLead($, current, paths)
    } else {
      await pollWorker($, current, paths)
    }
    isFirstPoll = false
    await refreshStatus($)
  } finally {
    isPolling = false
  }
}

function startPolling($: EngineInterface): void {
  poller?.cancel()
  poller = $.clock.every(POLL_MS, () => {
    void poll($)
  })
}

async function resetView($: EngineInterface): Promise<void> {
  await update($, tasks, () => [])
  await update($, answers, () => [])
  await update($, offer, () => null)
  await update($, isAttached, () => false)
  await update($, presence, () => null)
  await update($, isActive, () => false)
  announced.clear()
  fileCache.clear()
}

async function releaseWorkerSlot($: EngineInterface, current: Link | null): Promise<void> {
  if (current?.role === 'worker' && (await read($, isActive))) {
    await $.process.run(['rm', '-f', (await pathsOf($, current.channel)).presence])
  }
}

async function join($: EngineInterface, next: Link, isExplicit: boolean): Promise<void> {
  await releaseWorkerSlot($, await read($, link))
  await $.store.set(`${LINK_PREFIX}${await $.session.root()}`, next)
  await update($, link, () => next)
  await resetView($)
  isFirstPoll = true
  if (next.role === 'worker') {
    await claim($, next, isExplicit)
  }
  startPolling($)
  await poll($)
}

async function leave($: EngineInterface): Promise<void> {
  const current = await read($, link)
  poller?.cancel()
  poller = undefined
  await $.store.delete(`${LINK_PREFIX}${await $.session.root()}`)
  await releaseWorkerSlot($, current)
  await update($, link, () => null)
  await resetView($)
  await refreshStatus($)
  await $.ui.close({ id: PANE })
}

// A lead named without a channel joins the only channel there is, if one is.
async function existingChannels($: EngineInterface): Promise<string[]> {
  const directory = await relayDirectory($)
  if (!(await $.fs.exists(directory))) {
    return []
  }
  const entries = await $.fs.list(directory)

  return entries.filter(i => i.kind === 'dir' && channelOf(i.name) === i.name).map(i => i.name)
}

async function sendTask($: EngineInterface, text: string, isFresh: boolean): Promise<void> {
  const current = await read($, link)
  if (current?.role !== 'lead') {
    $.ui.toast('Only a lead sends tasks: /relay lead <channel> first.')
    return
  }
  const paths = await pathsOf($, current.channel)
  const pending = await readInbox($, paths.toWorker, isTask)
  await removeItems($, paths.toWorker, pending.map(i => i.id))
  const now = await $.clock.now()
  const task: Task = { id: newId(now, Math.random()), text, isFresh, sentAt: now }
  await writeItem($, paths.toWorker, task)
  await update($, offer, () => null)
  const held = await readPresence($, current.channel)
  const notes = [
    isFresh ? 'as a fresh session' : null,
    pending.length > 0 ? 'replaces the task not picked up yet' : null,
    isOnline(held, now) ? null : `no ${current.channel} session is open, it waits there`,
  ].filter(i => i !== null)
  $.ui.toast(`Sent to ${current.channel}${notes.length > 0 ? ` · ${notes.join(' · ')}` : ''}`)
}

async function sendLatestBlock($: EngineInterface): Promise<void> {
  const current = await read($, offer)
  const fromOffer = current?.blocks[current.index]
  if (fromOffer !== undefined) {
    await sendTask($, fromOffer, false)
    return
  }
  const messages = await $.session.messages()
  const lastAnswer = [...messages].reverse().find(i => i.role === 'assistant')
  const block = promptBlocksOf(lastAnswer?.text ?? '', 1).at(-1)
  if (block === undefined) {
    $.ui.toast('The last answer holds no fenced block to send; /relay send <text> sends text as typed.')
    return
  }
  await sendTask($, block, false)
}

async function takeTask($: EngineInterface, task: Task, isFresh: boolean): Promise<void> {
  const current = await read($, link)
  if (current?.role !== 'worker') {
    return
  }
  const paths = await pathsOf($, current.channel)
  await removeItems($, paths.toWorker, [task.id])
  await update($, tasks, items => items.filter(i => i.id !== task.id))
  await $.ui.close({ id: PANE })
  try {
    if (isFresh) {
      await $.command.run({ command: 'clear' })
    }
    await claim($, current, true)
    await $.prompt.submit({ text: task.text, asUser: true })
  } catch (error) {
    await writeItem($, paths.toWorker, task)
    $.ui.toast(`session-relay could not hand the task over; it is kept. ${error instanceof Error ? error.message : String(error)}`)
  }
  await refreshStatus($)
}

async function discardTask($: EngineInterface, task: Task): Promise<void> {
  const current = await read($, link)
  if (current === null) {
    return
  }
  await removeItems($, (await pathsOf($, current.channel)).toWorker, [task.id])
  await update($, tasks, items => items.filter(i => i.id !== task.id))
  await refreshStatus($)
}

async function dropAnswers($: EngineInterface, items: readonly Answer[]): Promise<void> {
  const current = await read($, link)
  if (current === null) {
    return
  }
  const ids = items.map(i => i.id)
  await removeItems($, (await pathsOf($, current.channel)).toLead, ids)
  const remaining = await update($, answers, list => list.filter(i => !ids.includes(i.id)))
  if (remaining.length === 0) {
    await update($, isAttached, () => false)
  }
  await refreshStatus($)
}

async function attachAnswers($: EngineInterface, isOn: boolean): Promise<void> {
  await update($, isAttached, () => isOn)
  await refreshStatus($)
  if (isOn) {
    $.ui.toast('The answer goes with your next prompt.')
  }
}

async function forwardAnswers($: EngineInterface): Promise<void> {
  const current = await read($, link)
  const items = await read($, answers)
  if (current === null || items.length === 0) {
    return
  }
  await $.ui.close({ id: PANE })
  await $.prompt.submit({ text: forwardTextOf(current.channel, items), asUser: true })
  await dropAnswers($, items)
}

async function report($: EngineInterface, current: Link, text: string): Promise<void> {
  const paths = await pathsOf($, current.channel)
  const now = await $.clock.now()
  const body = text.length > MAX_ANSWER_CHARS ? `${text.slice(0, MAX_ANSWER_CHARS)}\n\n[cut at ${MAX_ANSWER_CHARS} characters]` : text
  const answer: Answer = { id: newId(now, Math.random()), text: body, finishedAt: now }
  await writeItem($, paths.toLead, answer)
  const items = await readInbox($, paths.toLead, isAnswer)
  await removeItems($, paths.toLead, items.slice(0, Math.max(0, items.length - MAX_ANSWERS)).map(i => i.id))
}

async function cycleOffer($: EngineInterface): Promise<void> {
  await update($, offer, current =>
    current === null ? null : { ...current, index: (current.index + current.blocks.length - 1) % current.blocks.length },
  )
}

async function openPane($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: 'Relay', focus: true, closeOnEscape: true })
}

async function runCommand($: EngineInterface, args: string): Promise<void> {
  const command = parseCommand(args)
  if (command.kind === 'invalid') {
    $.ui.toast(command.reason)
    return
  }
  if (command.kind === 'open') {
    await poll($)
    await openPane($)
    return
  }
  if (command.kind === 'off') {
    const current = await read($, link)
    await leave($)
    $.ui.toast(current === null ? 'This folder was not linked.' : `Left ${current.channel}; this folder no longer joins it.`)
    return
  }
  if (command.kind === 'send') {
    if (command.text.length > 0) {
      await sendTask($, command.text, false)
    } else {
      await sendLatestBlock($)
    }
    return
  }
  const root = await $.session.root()
  let channel = command.channel
  if (channel === null && command.role === 'worker') {
    channel = channelOf(folderNameOf(root))
  }
  if (channel === null && command.role === 'lead') {
    const channels = await existingChannels($)
    channel = channels.length === 1 ? (channels[0] ?? null) : null
    if (channel === null) {
      const known = channels.length > 0 ? ` Known: ${channels.join(', ')}.` : ''
      $.ui.toast(`Name the channel: /relay lead <channel>.${known}`)
      return
    }
  }
  if (channel === null) {
    $.ui.toast(`This folder's name is no channel name; /relay worker <channel> names one.`)
    return
  }
  const previous = await read($, link)
  await join($, { role: command.role, channel }, true)
  const wasOther =
    previous !== null && (previous.role !== command.role || previous.channel !== channel)
      ? ` This folder was the ${previous.role} of ${previous.channel} until now.`
      : ''
  $.ui.toast(
    command.role === 'lead'
      ? `Lead of ${channel}. A prompt in a fenced block can go to the worker from the band above the prompt.${wasOther}`
      : `Worker of ${channel}. Tasks from the lead show above the prompt; every answer goes back to it.${wasOther}`,
  )
}

export const register: Register = (on, options) => {
  settings = {
    minPromptChars: Number(options.minPromptChars ?? 300),
    isNotifying: options.notify !== false,
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'relay',
      description: 'Pass prompts and answers between a planning session and the session that does the work',
      argumentHint: 'lead <channel> | worker [channel] | send [text] | off',
      immediate: true,
    })
    const result = await next(e)
    const stored = await $.store.get(`${LINK_PREFIX}${await $.session.root()}`)
    if (isLink(stored)) {
      await join($, stored, false)
    }

    return result
  })

  // A /clear or /resume starts no session.start: the offer and an attached answer
  // belong to the conversation that was left, and a worker goes on under a new id.
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (e.source !== 'clear' && e.source !== 'resume') {
      return result
    }
    await update($, offer, () => null)
    await update($, isAttached, () => false)
    const current = await read($, link)
    if (current?.role === 'worker') {
      await claim($, current, true)
    }
    await refreshStatus($)

    return result
  })

  on('session.end', async ($, e, next) => {
    const current = await read($, link)
    if (e.reason !== 'clear' && e.reason !== 'resume' && current?.role === 'worker' && (await read($, isActive))) {
      await $.process.run(['rm', '-f', (await pathsOf($, current.channel)).presence]).catch(() => undefined)
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    const current = await read($, link)
    if (current?.role === 'worker') {
      await claim($, current, true, await $.clock.now())
      await refreshStatus($)
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const current = await read($, link)
    if (e.agentId !== undefined || current === null) {
      return result
    }
    if (current.role === 'lead') {
      const blocks = e.reason === 'answer' ? promptBlocksOf(e.answer, settings.minPromptChars) : []
      await update($, offer, () => (blocks.length === 0 ? null : { blocks, index: blocks.length - 1 }))
      return result
    }
    if (!(await read($, isActive))) {
      return result
    }
    await writePresence($, current.channel, null)
    if (e.reason === 'answer' && e.answer.trim().length > 0) {
      await report($, current, e.answer)
    }
    await refreshStatus($)

    return result
  })

  // Typing a prompt in the lead, here or through Remote Control, drops a pending
  // offer, which belonged to the answer before it, and takes attached answers
  // along as context.
  on('prompt.submit', async ($, e, next) => {
    const current = await read($, link)
    const isTyped = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (current?.role !== 'lead' || !isTyped || e.text.trimStart().startsWith('/')) {
      return next(e)
    }
    await update($, offer, () => null)
    const items = await read($, answers)
    if (!(await read($, isAttached)) || items.length === 0) {
      return next(e)
    }
    const result = await next({ ...e, context: [...(e.context ?? []), forwardTextOf(current.channel, items)] })
    if (result.drop === undefined) {
      await dropAnswers($, items)
    }

    return result
  })

  on('command.run', { command: 'relay' }, async ($, e) => {
    await runCommand($, e.args)

    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, link)
    if (current === null || e.props.hasSurvey || e.props.isWorking) {
      return next(e)
    }
    const currentOffer = await read($, offer)
    const block = currentOffer?.blocks[currentOffer.index]
    const items = await read($, answers)
    const attached = await read($, isAttached)
    const task = (await read($, tasks)).at(-1)
    const active = await read($, isActive)
    const hasLead = current.role === 'lead' && (block !== undefined || items.length > 0)
    const hasWorker = current.role === 'worker' && task !== undefined
    if (!hasLead && !hasWorker) {
      return next(e)
    }
    // Another mod's band (cache-watch) may be drawn beneath; it stays under this
    // one. An `engine` element means none was, and it cannot be nested.
    const below = await next(e)
    const beneath = below.type === 'engine' ? null : below
    const { Box, Button, Text } = $.ui.resolve(e)
    const latest = items.at(-1)
    const blockCount = currentOffer?.blocks.length ?? 0

    return (
      <Box flexDirection="column">
        {current.role === 'lead' && block !== undefined && (
          <Box key="offer" flexDirection="column">
            <Text wrap="truncate-end">
              {`Prompt for ${current.channel}${blockCount > 1 ? ` (${(currentOffer?.index ?? 0) + 1}/${blockCount})` : ''} · ${formatChars(block.length)} · ${previewOf(block)}`}
            </Text>
            <Box flexDirection="row" columnGap={2} flexWrap="wrap">
              <Button key="send" label="Send" hotkey="s" variant="primary" onPress={() => sendTask($, block, false)} />
              <Button key="send-fresh" label="Send as fresh session" hotkey="n" onPress={() => sendTask($, block, true)} />
              {blockCount > 1 && <Button key="other" label="Other block" hotkey="o" onPress={() => cycleOffer($)} />}
              <Button key="view-offer" label="View" hotkey="v" onPress={() => openPane($)} />
              <Button key="dismiss-offer" label="Dismiss" hotkey="x" role="dismiss" onPress={() => update($, offer, () => null)} />
            </Box>
          </Box>
        )}
        {current.role === 'lead' && latest !== undefined && attached && (
          <Box key="attached" flexDirection="column">
            <Text wrap="truncate-end">{`📎 ${items.length === 1 ? 'The answer' : `${items.length} answers`} from ${current.channel} go with your next prompt`}</Text>
            <Box flexDirection="row" columnGap={2}>
              <Button key="detach" label="Detach" hotkey="u" onPress={() => attachAnswers($, false)} />
              <Button key="view-answers" label="View" hotkey="r" onPress={() => openPane($)} />
            </Box>
          </Box>
        )}
        {current.role === 'lead' && latest !== undefined && !attached && (
          <Box key="answers" flexDirection="column">
            <Text wrap="truncate-end">
              {`${current.channel} answered${items.length > 1 ? ` ${items.length}×` : ''} · ${formatChars(latest.text.length)} · ${previewOf(latest.text)}`}
            </Text>
            <Box flexDirection="row" columnGap={2} flexWrap="wrap">
              <Button
                key="attach"
                label="Attach to next prompt"
                hotkey="a"
                {...(block === undefined ? { variant: 'primary' as const } : {})}
                onPress={() => attachAnswers($, true)}
              />
              <Button key="forward" label="Forward now" hotkey="f" onPress={() => forwardAnswers($)} />
              <Button key="view-answers" label="View" hotkey="r" onPress={() => openPane($)} />
              <Button key="discard-answers" label="Discard" hotkey="d" onPress={() => dropAnswers($, items)} />
            </Box>
          </Box>
        )}
        {current.role === 'worker' && task !== undefined && !active && (
          <Box key="inactive" flexDirection="column">
            <Text wrap="truncate-end">{`A task for ${current.channel} waits, but another session in this folder is the worker.`}</Text>
            <Box flexDirection="row" columnGap={2}>
              <Button key="take-over" label="Take over" hotkey="t" variant="primary" onPress={() => claim($, current, true)} />
            </Box>
          </Box>
        )}
        {current.role === 'worker' && task !== undefined && active && (
          <Box key="task" flexDirection="column">
            <Text wrap="truncate-end">
              {`Task from the lead${task.isFresh ? ' · for a fresh session' : ''} · ${formatChars(task.text.length)} · ${previewOf(task.text)}`}
            </Text>
            <Box flexDirection="row" columnGap={2} flexWrap="wrap">
              <Button
                key="send-fresh"
                label="Clear & send"
                hotkey="n"
                {...(task.isFresh ? { variant: 'primary' as const } : {})}
                onPress={() => takeTask($, task, true)}
              />
              <Button
                key="send"
                label="Send here"
                hotkey="s"
                {...(task.isFresh ? {} : { variant: 'primary' as const })}
                onPress={() => takeTask($, task, false)}
              />
              <Button key="view-task" label="View" hotkey="v" onPress={() => openPane($)} />
              <Button key="discard-task" label="Discard" hotkey="d" onPress={() => discardTask($, task)} />
            </Box>
          </Box>
        )}
        {beneath}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const current = await read($, link)
    if (current === null) {
      return (
        <Box flexDirection="column">
          <Text>This folder is not linked to a relay channel.</Text>
          <Text dimColor>{USAGE}</Text>
        </Box>
      )
    }
    const status = statusOf({
      link: current,
      presence: await read($, presence),
      answers: await read($, answers),
      tasks: await read($, tasks),
      isAttached: await read($, isAttached),
      isActive: await read($, isActive),
      now: await $.clock.now(),
    })
    const currentOffer = await read($, offer)
    const block = currentOffer?.blocks[currentOffer.index]
    const items = await read($, answers)
    const task = (await read($, tasks)).at(-1)
    const isEmpty = current.role === 'lead' ? block === undefined && items.length === 0 : task === undefined

    return (
      <Box flexDirection="column">
        <Text bold>{status}</Text>
        {current.role === 'lead' && block !== undefined && (
          <Box key="offer" flexDirection="column" marginTop={1}>
            <Text bold>{`Prompt for ${current.channel}`}</Text>
            <Markdown text={block} />
            <Box flexDirection="row" columnGap={2} flexWrap="wrap">
              <Button key="pane-send" label="Send" variant="primary" onPress={() => sendTask($, block, false)} />
              <Button key="pane-send-fresh" label="Send as fresh session" onPress={() => sendTask($, block, true)} />
            </Box>
          </Box>
        )}
        {current.role === 'lead' &&
          items.map((answer, index) => (
            <Box key={`answer-${answer.id}`} flexDirection="column" marginTop={1}>
              <Text bold>{`Answer ${index + 1} of ${items.length} from ${current.channel} · ${formatChars(answer.text.length)}`}</Text>
              <Markdown text={answer.text} />
            </Box>
          ))}
        {current.role === 'lead' && items.length > 0 && (
          <Box key="answer-actions" flexDirection="row" columnGap={2} flexWrap="wrap" marginTop={1}>
            <Button key="pane-attach" label="Attach to next prompt" variant="primary" onPress={() => attachAnswers($, true)} />
            <Button key="pane-forward" label="Forward now" onPress={() => forwardAnswers($)} />
            <Button key="pane-discard" label="Discard" onPress={() => dropAnswers($, items)} />
          </Box>
        )}
        {current.role === 'worker' && task !== undefined && (
          <Box key="task" flexDirection="column" marginTop={1}>
            <Text bold>{`Task from the lead${task.isFresh ? ' · for a fresh session' : ''}`}</Text>
            <Markdown text={task.text} />
            <Box flexDirection="row" columnGap={2} flexWrap="wrap">
              <Button key="pane-clear-send" label="Clear & send" {...(task.isFresh ? { variant: 'primary' as const } : {})} onPress={() => takeTask($, task, true)} />
              <Button key="pane-send-here" label="Send here" {...(task.isFresh ? {} : { variant: 'primary' as const })} onPress={() => takeTask($, task, false)} />
              <Button key="pane-discard-task" label="Discard" onPress={() => discardTask($, task)} />
            </Box>
          </Box>
        )}
        {isEmpty && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>Nothing pending.</Text>
            <Text dimColor>{USAGE}</Text>
          </Box>
        )}
      </Box>
    )
  })
}
