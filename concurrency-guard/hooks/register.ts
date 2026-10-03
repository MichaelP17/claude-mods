import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TrackedMonitor } from '../types'
import { REASON_PREFIX, parseTaskEnds, requestedLimits, takeReasonLine, takeReasonPrefix } from './limits'
import type { Kind } from './limits'

const ALLOW_ONCE = 'Allow once'
const ALLOW_SESSION = 'No limit this session'
const DENY = 'Deny'
// Stored state is JSON, where Infinity would come back as null.
const UNLIMITED = 1_000_000

const monitors = atom({ plugin: 'concurrency-guard', key: 'monitors' } as const, [])
const overrides = atom({ plugin: 'concurrency-guard', key: 'overrides' } as const, { subagents: null, monitors: null })

const LABELS: Record<Kind, string> = { subagents: 'subagent', monitors: 'monitor' }

// Several Agent calls in one message are checked at the same moment, before any
// of them shows up as running. Decisions therefore run one after another, and a
// call that was let through counts as reserved until it is visibly running.
const reservations: Record<Kind, Set<string>> = { subagents: new Set(), monitors: new Set() }
let decisionQueue: Promise<unknown> = Promise.resolve()

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const run = decisionQueue.then(work, work)
  decisionQueue = run.catch(() => undefined)

  return run
}

async function runningMonitors($: EngineInterface): Promise<TrackedMonitor[]> {
  const now = await $.clock.now()
  const list = await read($, monitors)
  const alive = list.filter(i => i.deadline === null || i.deadline > now)
  if (alive.length !== list.length) {
    await update($, monitors, () => alive)
  }

  return alive
}

async function runningSubagents($: EngineInterface): Promise<number> {
  const monitorIds = new Set((await read($, monitors)).map(i => i.taskId))
  const agents = await $.agent.list()

  return agents.filter(i => i.status === 'running' && !monitorIds.has(i.id)).length
}

async function running($: EngineInterface, kind: Kind): Promise<number> {
  const visible = kind === 'subagents' ? await runningSubagents($) : (await runningMonitors($)).length

  return visible + reservations[kind].size
}

// Set from the plugin's options when the module registers.
let defaults: Record<Kind, number> = { subagents: 4, monitors: 3 }

async function limit($: EngineInterface, kind: Kind): Promise<number> {
  return (await read($, overrides))[kind] ?? defaults[kind]
}

async function refreshStatus($: EngineInterface): Promise<void> {
  const subagents = await running($, 'subagents')
  const monitorCount = await running($, 'monitors')
  if (subagents === 0 && monitorCount === 0) {
    $.ui.status(undefined)

    return
  }
  const format = async (count: number, kind: Kind) => {
    const max = await limit($, kind)

    return `${count}/${max >= UNLIMITED ? '∞' : max}`
  }
  $.ui.status(`agents ${await format(subagents, 'subagents')} · monitors ${await format(monitorCount, 'monitors')}`)
}

// Under the limit the call runs untouched. At the limit it is refused once
// with instructions; only a retry that states a reason reaches the person.
async function gate(
  $: EngineInterface,
  kind: Kind,
  task: string,
  reason: string | null,
  retryHint: string,
): Promise<{ deny: string } | null> {
  const count = await running($, kind)
  const max = await limit($, kind)
  if (count < max) {
    return null
  }
  if (reason === null || reason.length === 0) {
    return {
      deny: `Concurrency limit reached: ${count} ${kind} are running and the limit is ${max}. Wait for one to finish. Only if another one in parallel is really necessary, ${retryHint} The user will be asked to approve.`,
    }
  }

  let answer: string
  try {
    answer = await $.ui.ask(
      `Claude wants to start ${LABELS[kind]} ${count + 1} while the limit is ${max}.\n\nTask: ${task}\nReason: ${reason}\n\nAllow it?`,
      { options: [ALLOW_ONCE, ALLOW_SESSION, DENY], header: 'Parallel' },
    )
  } catch {
    answer = DENY
  }

  if (answer === ALLOW_ONCE) {
    return null
  }
  if (answer === ALLOW_SESSION) {
    await update($, overrides, current => ({ ...current, [kind]: UNLIMITED }))
    $.ui.toast(`No ${LABELS[kind]} limit for the rest of this session.`)

    return null
  }
  const note = answer === DENY ? '' : ` The user answered: "${answer}".`

  return { deny: `The user did not approve another ${LABELS[kind]} beyond the limit of ${max}.${note} Wait for running ones to finish.` }
}

export const register: Register = (on, options) => {
  defaults = {
    subagents: Number(options.maxSubagents ?? 4),
    monitors: Number(options.maxMonitors ?? 3),
  }

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer') {
      const requested = requestedLimits(e.text)
      for (const kind of ['subagents', 'monitors'] as const) {
        const value = requested[kind]
        if (value !== undefined && value > defaults[kind]) {
          await update($, overrides, current => ({ ...current, [kind]: value }))
          $.ui.toast(`${LABELS[kind]} limit raised to ${value} for this session.`)
        }
      }
    }

    if (e.origin.kind === 'task-notification') {
      const ended = new Set(parseTaskEnds(e.text).map(i => i.taskId))
      if (ended.size > 0) {
        await update($, monitors, list => list.filter(i => !ended.has(i.taskId)))
      }
    }
    await refreshStatus($)

    return next(e)
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const { reason, rest } = takeReasonLine(e.prompt)
    const refusal = await serialized(async () => {
      const decision = await gate(
        $,
        'subagents',
        e.description,
        reason,
        `retry this exact call with "${REASON_PREFIX} <one sentence why>" as the first line of \`prompt\`.`,
      )
      if (decision === null) {
        reservations.subagents.add(e.tool_use_id)
      }

      return decision
    })
    if (refusal !== null) {
      return refusal
    }
    try {
      return await next(reason === null ? e : { ...e, prompt: rest })
    } finally {
      reservations.subagents.delete(e.tool_use_id)
      await refreshStatus($)
    }
  })

  // A foreground subagent's tool call only returns when it is done; once it has
  // spawned it is listed as running, so the reservation is no longer needed.
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    reservations.subagents.delete(e.tool_use_id)

    return result
  })

  on('tool.call', { tool: 'Monitor' }, async ($, e, next) => {
    const { reason, rest } = takeReasonPrefix(e.description)
    const refusal = await serialized(async () => {
      const decision = await gate(
        $,
        'monitors',
        rest,
        reason,
        `retry this exact call with \`description\` set to "${REASON_PREFIX} <one sentence why> | <description>".`,
      )
      if (decision === null) {
        reservations.monitors.add(e.tool_use_id)
      }

      return decision
    })
    if (refusal !== null) {
      return refusal
    }
    try {
      const result = await next(reason === null ? e : { ...e, description: rest })
      if (result.deny === undefined && result.isError !== true) {
        const now = await $.clock.now()
        const deadline = result.result.persistent === true || result.result.timeoutMs === 0 ? null : now + result.result.timeoutMs
        await update($, monitors, list => [...list, { taskId: result.result.taskId, description: rest, deadline }])
      }

      return result
    } finally {
      reservations.monitors.delete(e.tool_use_id)
      await refreshStatus($)
    }
  })

  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const result = await next(e)
    const taskId = e.task_id ?? e.shell_id
    if (taskId !== undefined) {
      await update($, monitors, list => list.filter(i => i.taskId !== taskId))
    }
    await refreshStatus($)

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refreshStatus($)

    return result
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, overrides, () => ({ subagents: null, monitors: null }))
      await update($, monitors, () => [])
      $.ui.status(undefined)
    }

    return next(e)
  })
}
