import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GitState, Snapshot } from '../types'
import { parseGitStatus, segmentsOf } from './format'

const PLUGIN = 'status-band'
const REFRESH_MS = 30_000
const GIT_MIN_INTERVAL_MS = 5_000

const snapshot = atom({ plugin: 'status-band', key: 'snapshot' } as const, null)
const statuses = atom({ plugin: 'status-band', key: 'statuses' } as const, {})

let permissionMode: string | null = null
let agent: string | null = null
let git: { directory: string; at: number; state: GitState | null } | null = null

async function isDrawnRemotely($: EngineInterface): Promise<boolean> {
  const surfaces = await $.session.surfaces()

  return surfaces.some(i => i !== 'terminal')
}

async function readGit($: EngineInterface, directory: string): Promise<GitState | null> {
  try {
    const status = await $.process.run(['git', 'status', '--porcelain=v2', '--branch', '--untracked-files=normal'], {
      cwd: directory,
      timeoutMs: 2_000,
    })
    if (status.exitCode !== 0) {
      return null
    }
    const state = parseGitStatus(status.stdout)
    if (state === null) {
      return null
    }
    const paths = await $.process.run(['git', 'rev-parse', '--git-dir', '--git-common-dir', '--show-toplevel'], {
      cwd: directory,
      timeoutMs: 2_000,
    })
    const [gitDirectory, commonDirectory, topLevel] = paths.stdout.trim().split('\n')
    const isLinkedWorktree = paths.exitCode === 0 && gitDirectory !== commonDirectory && topLevel !== undefined

    return { ...state, worktree: isLinkedWorktree ? (topLevel.split('/').at(-1) ?? null) : null }
  } catch {
    return null
  }
}

async function gitFor($: EngineInterface, directory: string, now: number, isForced: boolean): Promise<GitState | null> {
  const isFresh = git !== null && git.directory === directory && now - git.at < GIT_MIN_INTERVAL_MS
  if (git !== null && isFresh && !isForced) {
    return git.state
  }
  const state = await readGit($, directory)
  git = { directory, at: now, state }

  return state
}

async function refresh($: EngineInterface, isGitForced = false): Promise<void> {
  if (!(await isDrawnRemotely($))) {
    return
  }
  const [model, directory, usage, settings, now, home] = await Promise.all([
    $.session.model(),
    $.session.cwd(),
    $.session.usage(),
    $.settings.read(),
    $.clock.now(),
    $.env.get('HOME'),
  ])
  const fiveHour = usage.rateLimits.find(i => i.kind === 'five_hour')
  const outputStyle = settings.outputStyle

  const next: Snapshot = {
    model,
    permissionMode,
    agent,
    isFastMode: settings.fastMode === true,
    isThinkingOff: settings.alwaysThinkingEnabled === false,
    outputStyle: typeof outputStyle === 'string' ? outputStyle : null,
    directory,
    home: home ?? '',
    git: await gitFor($, directory, now, isGitForced),
    contextPercent: usage.context.percent ?? null,
    fiveHour: fiveHour === undefined ? null : { percent: fiveHour.percentUsed, resetsAt: fiveHour.resetsAt ?? null },
    costUsd: usage.cost?.usd ?? null,
    durationMs: now - usage.startedAt,
  }
  await update($, snapshot, () => next)
}

function noteMode(input: { permission_mode?: string; agent_id?: string; agent_type?: string }): void {
  // Subagents run under their own mode; only the main thread's counts here.
  if (input.agent_id !== undefined) {
    return
  }
  permissionMode = input.permission_mode ?? permissionMode
  agent = input.agent_type ?? null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    $.clock.every(REFRESH_MS, () => {
      void refresh($)
    })
    await refresh($, true)

    return result
  })

  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    await refresh($, true)

    return result
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    noteMode(e)
    const result = await next(e)
    await refresh($)

    return result
  })

  on('classic.Stop', async ($, e, next) => {
    noteMode(e)

    return next(e)
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
    await refresh($, true)

    return result
  })

  on('classic.PostModelSwitch', async ($, e, next) => {
    const result = await next(e)
    await refresh($)

    return result
  })

  on('classic.CwdChanged', async ($, e, next) => {
    const result = await next(e)
    await refresh($, true)

    return result
  })

  on('classic.ConfigChange', async ($, e, next) => {
    const result = await next(e)
    await refresh($)

    return result
  })

  // Other mods pin their state with $.ui.status, which the terminal draws under
  // the prompt; the band repeats those lines so they reach the desktop too.
  on('ui.status', async ($, e, next) => {
    const source = next.origin.plugin
    if (source !== PLUGIN) {
      await update($, statuses, current => {
        const { [source]: _, ...rest } = current ?? {}

        return e.text === undefined || e.text === '' ? rest : { ...rest, [source]: e.text }
      })
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface === 'terminal' || e.props.hasSurvey) {
      return next(e)
    }
    const current = await read($, snapshot)
    const pinned = Object.entries(await read($, statuses))
    const below = await next(e)
    if (current === null && pinned.length === 0) {
      return below
    }
    // An `engine` element means nothing beneath drew a band; it cannot be nested.
    const beneath = below.type === 'engine' ? null : below
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {current === null ? null : (
          <Box flexDirection="row" flexWrap="wrap">
            {segmentsOf(current).map((segment, index) => (
              <Text key={`segment-${index}`}>
                {index === 0 ? null : <Text dimColor> │ </Text>}
                {segment.map((span, position) => (
                  <Text key={`span-${position}`} color={span.color} dimColor={span.isDim}>
                    {span.text}
                  </Text>
                ))}
              </Text>
            ))}
          </Box>
        )}
        {pinned.length === 0 ? null : <Text dimColor>{pinned.map(([, text]) => text).join(' · ')}</Text>}
        {beneath}
      </Box>
    )
  })
}
