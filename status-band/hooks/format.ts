import type { GitState, Snapshot, Span } from '../types'

export const COLORS = {
  cyan: '#1aa3b8',
  blue: '#3b82f6',
  magenta: '#a855f7',
  green: '#22a355',
  yellow: '#d4a017',
  red: '#e5484d',
}

const BAR_SIZE = 10

const PERMISSION_LABELS: Readonly<Record<string, string>> = {
  plan: 'plan',
  acceptEdits: 'auto-edit',
  bypassPermissions: 'bypass',
}

export function modelName(model: string): string {
  const trimmed = model
    .replace(/\[[^\]]*\]$/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim()
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(trimmed)
  if (match === null) {
    return trimmed === '' ? model : trimmed
  }
  const [, name = '', major = '', minor] = match
  const family = name.charAt(0).toUpperCase() + name.slice(1)

  return minor === undefined ? `${family} ${major}` : `${family} ${major}.${minor}`
}

export function usageColor(percent: number): string {
  if (percent >= 85) {
    return COLORS.red
  }
  if (percent >= 60) {
    return COLORS.yellow
  }

  return COLORS.green
}

export function shortenPath(path: string, home: string): string {
  if (home !== '' && (path === home || path.startsWith(`${home}/`))) {
    return `~${path.slice(home.length)}`
  }

  return path
}

export function formatSpan(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) {
    return `${hours}h${String(minutes).padStart(2, '0')}`
  }
  if (minutes > 0) {
    return `${minutes}m`
  }

  return `${seconds}s`
}

export function formatClock(iso: string): string {
  const date = new Date(iso)

  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function parseGitStatus(output: string): GitState | null {
  let branch: string | null = null
  let oid: string | null = null
  const state: GitState = { branch: '', worktree: null, changed: 0, untracked: 0, ahead: 0, behind: 0 }

  for (const line of output.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      branch = line.slice('# branch.head '.length).trim()
    } else if (line.startsWith('# branch.oid ')) {
      oid = line.slice('# branch.oid '.length).trim()
    } else if (line.startsWith('# branch.ab ')) {
      const match = /^# branch\.ab \+(\d+) -(\d+)/.exec(line)
      if (match !== null) {
        state.ahead = Number(match[1])
        state.behind = Number(match[2])
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) {
      state.changed += 1
    } else if (line.startsWith('? ')) {
      state.untracked += 1
    }
  }

  if (branch === null && oid === null) {
    return null
  }
  if (branch === null || branch === '(detached)') {
    branch = oid === null || oid === '(initial)' ? 'detached' : oid.slice(0, 7)
  }

  return { ...state, branch }
}

function modeSpans(snapshot: Snapshot): Span[] {
  const spans: Span[] = []
  const add = (span: Span) => {
    if (spans.length > 0) {
      spans.push({ text: ' ' })
    }
    spans.push(span)
  }

  const permission = snapshot.permissionMode
  if (permission !== null && permission !== 'default') {
    add({ text: PERMISSION_LABELS[permission] ?? permission, color: permission === 'bypassPermissions' ? COLORS.red : COLORS.yellow })
  }
  if (snapshot.isFastMode) {
    add({ text: 'fast', color: COLORS.yellow })
  }
  if (snapshot.isThinkingOff) {
    add({ text: 'no-think', isDim: true })
  }
  if (snapshot.outputStyle !== null && snapshot.outputStyle.toLowerCase() !== 'default') {
    add({ text: snapshot.outputStyle, color: COLORS.blue })
  }
  if (snapshot.agent !== null) {
    add({ text: snapshot.agent, color: COLORS.magenta })
  }

  return spans
}

function gitSpans(git: GitState): Span[] {
  const spans: Span[] = [{ text: `⎇ ${git.branch}`, color: COLORS.magenta }]
  if (git.worktree !== null) {
    spans.push({ text: `@${git.worktree}`, isDim: true })
  }
  const marks: Span[] = []
  if (git.changed > 0) {
    marks.push({ text: `●${git.changed}`, color: COLORS.yellow })
  }
  if (git.untracked > 0) {
    marks.push({ text: `?${git.untracked}`, isDim: true })
  }
  if (git.ahead > 0) {
    marks.push({ text: `↑${git.ahead}`, color: COLORS.green })
  }
  if (git.behind > 0) {
    marks.push({ text: `↓${git.behind}`, color: COLORS.red })
  }
  if (marks.length === 0) {
    marks.push({ text: '✓', color: COLORS.green })
  }
  for (const mark of marks) {
    spans.push({ text: ' ' }, mark)
  }

  return spans
}

function contextSpans(percent: number): Span[] {
  const clamped = Math.max(0, Math.min(100, percent))
  const color = usageColor(clamped)
  const filled = Math.max(0, Math.min(BAR_SIZE, Math.round((clamped / 100) * BAR_SIZE)))

  return [
    { text: '█'.repeat(filled), color },
    { text: '░'.repeat(BAR_SIZE - filled), isDim: true },
    { text: ` ${Math.round(clamped)}%`, color },
  ]
}

function rateLimitSpans(snapshot: Snapshot): Span[] {
  const window = snapshot.fiveHour
  if (window === null || window.resetsAt === null) {
    return [{ text: '5h –', isDim: true }]
  }
  const color = usageColor(window.percent)

  return [
    { text: '5h ' },
    { text: `${Math.round(window.percent)}%`, color },
    { text: ` ↻ ${formatClock(window.resetsAt)}`, isDim: true },
  ]
}

export function segmentsOf(snapshot: Snapshot): Span[][] {
  const segments: Span[][] = [[{ text: modelName(snapshot.model), color: COLORS.cyan }]]

  const mode = modeSpans(snapshot)
  if (mode.length > 0) {
    segments.push(mode)
  }
  segments.push([{ text: shortenPath(snapshot.directory, snapshot.home), color: COLORS.blue }])
  if (snapshot.git !== null) {
    segments.push(gitSpans(snapshot.git))
  }
  if (snapshot.contextPercent !== null) {
    segments.push(contextSpans(snapshot.contextPercent))
  }
  segments.push(rateLimitSpans(snapshot))
  if (snapshot.costUsd !== null) {
    segments.push([
      { text: `$${snapshot.costUsd.toFixed(2)}`, color: COLORS.green },
      { text: ` ${formatSpan(snapshot.durationMs)}`, isDim: true },
    ])
  }

  return segments
}
