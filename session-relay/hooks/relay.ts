import type { Answer, Link, Presence, Role, Task } from '../types'

export const STALE_MS = 90_000

export const USAGE =
  '/relay lead <channel> in the planning session, /relay worker [channel] in the session that does the work, /relay send [text], /relay off, /relay alone shows what is pending.'

// Prompts for the other session come as fenced blocks without a language or
// tagged as text; a block tagged bash, json or ts is code to read, not to relay.
const PROMPT_LANGUAGES = new Set(['', 'text', 'txt', 'plaintext', 'markdown', 'md', 'prompt'])

const OPENING_FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})\s*$/

export type RelayCommand =
  | { kind: 'open' }
  | { kind: 'join'; role: Role; channel: string | null }
  | { kind: 'send'; text: string }
  | { kind: 'off' }
  | { kind: 'invalid'; reason: string }

export function promptBlocksOf(answer: string, minChars: number): string[] {
  const blocks: string[] = []
  let open: { indent: number; marker: string; language: string; lines: string[] } | null = null
  for (const line of answer.replace(/\r\n?/g, '\n').split('\n')) {
    if (open === null) {
      const match = OPENING_FENCE.exec(line)
      const [, indent = '', marker = '', info = ''] = match ?? []
      // A backtick fence whose info string holds a backtick is inline code.
      if (match === null || (marker.startsWith('`') && info.includes('`'))) {
        continue
      }
      open = { indent: indent.length, marker, language: (info.trim().split(/\s+/)[0] ?? '').toLowerCase(), lines: [] }
      continue
    }
    const closing = CLOSING_FENCE.exec(line)?.[1]
    if (closing !== undefined && closing[0] === open.marker[0] && closing.length >= open.marker.length) {
      const body = open.lines.join('\n').trim()
      if (PROMPT_LANGUAGES.has(open.language) && body.length >= minChars) {
        blocks.push(body)
      }
      open = null
      continue
    }
    const strip = Math.min(open.indent, line.length - line.trimStart().length)
    open.lines.push(line.slice(strip))
  }

  return blocks
}

export function channelOf(text: string): string | null {
  const channel = text.trim().toLowerCase().replace(/\s+/g, '-')

  return /^[a-z0-9][a-z0-9._-]{0,39}$/.test(channel) ? channel : null
}

export function folderNameOf(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(i => i.length > 0)

  return parts.at(-1) ?? ''
}

export function parseCommand(args: string): RelayCommand {
  const trimmed = args.trim()
  if (trimmed.length === 0) {
    return { kind: 'open' }
  }
  const word = trimmed.split(/\s+/)[0] ?? ''
  const remainder = trimmed.slice(word.length).trim()
  const action = word.toLowerCase()
  if (action === 'lead' || action === 'worker') {
    if (remainder.length === 0) {
      return { kind: 'join', role: action, channel: null }
    }
    const channel = channelOf(remainder)
    if (channel === null) {
      return {
        kind: 'invalid',
        reason: `"${remainder}" is not a channel name: letters, digits, dots, dashes and underscores, up to 40.`,
      }
    }

    return { kind: 'join', role: action, channel }
  }
  if (action === 'send') {
    return { kind: 'send', text: remainder }
  }
  if (action === 'off') {
    return { kind: 'off' }
  }

  return { kind: 'invalid', reason: USAGE }
}

export function previewOf(text: string, maxChars = 70): string {
  const line =
    text
      .split('\n')
      .map(i => i.replace(/^\s*(#+|>|[-*+]|\d+\.)\s+/, '').replace(/[*_`]/g, '').trim())
      .find(i => i.length > 0) ?? ''

  return line.length > maxChars ? `${line.slice(0, maxChars - 1).trimEnd()}…` : line
}

export function formatChars(count: number): string {
  return count < 1000 ? `${count} chars` : `${(count / 1000).toFixed(1)}k chars`
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m`
  }

  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

export function forwardTextOf(channel: string, answers: readonly Answer[]): string {
  if (answers.length === 1) {
    return `The latest answer from the Claude session working on "${channel}", relayed unchanged:\n\n${answers[0]?.text ?? ''}`
  }
  const parts = answers.map((answer, index) => `--- Answer ${index + 1} of ${answers.length} ---\n\n${answer.text}`)

  return `The latest ${answers.length} answers from the Claude session working on "${channel}", oldest first, relayed unchanged:\n\n${parts.join('\n\n')}`
}

export function isOnline(presence: Presence | null, now: number): presence is Presence {
  return presence !== null && now - presence.seenAt <= STALE_MS
}

export type StatusInput = {
  link: Link
  presence: Presence | null
  answers: readonly Answer[]
  tasks: readonly Task[]
  isAttached: boolean
  isActive: boolean
  now: number
}

export function statusOf(input: StatusInput): string {
  const { link, presence, answers, tasks, isAttached, isActive, now } = input
  if (link.role === 'worker') {
    const parts = [`⇄ ${link.channel} · worker`]
    if (!isActive) {
      parts.push('another session is the worker')
    } else if (tasks.length > 0) {
      parts.push('task waiting')
    }

    return parts.join(' · ')
  }
  const parts = [`⇄ ${link.channel}`]
  if (!isOnline(presence, now)) {
    parts.push('no worker open')
  } else if (presence.busySince !== null) {
    parts.push(`working ${formatDuration(now - presence.busySince)}`)
  }
  if (answers.length > 0) {
    const count = answers.length === 1 ? '1 answer' : `${answers.length} answers`
    parts.push(isAttached ? `${count} attached` : `${count} waiting`)
  }

  return parts.join(' · ')
}

export function footerOf(input: StatusInput): string {
  const { link, presence, answers, tasks, isAttached, isActive, now } = input
  const parts = [`⇄ ${link.channel}`]
  if (link.role === 'worker') {
    parts.push('worker')
    if (!isActive) {
      parts.push('⏸')
    } else if (tasks.length > 0) {
      parts.push('📥')
    }

    return parts.join(' ')
  }
  if (!isOnline(presence, now)) {
    parts.push('offline')
  } else if (presence.busySince !== null) {
    parts.push(`⚙ ${formatDuration(now - presence.busySince)}`)
  }
  if (answers.length > 0) {
    parts.push(`${isAttached ? '📎' : '📨'} ${answers.length}`)
  }

  return parts.join(' ')
}

export function newId(now: number, random: number): string {
  const suffix = Math.floor(random * 36 ** 6)
    .toString(36)
    .padStart(6, '0')

  return `${String(now).padStart(14, '0')}-${suffix}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isLink(value: unknown): value is Link {
  return (
    isRecord(value) &&
    (value.role === 'lead' || value.role === 'worker') &&
    typeof value.channel === 'string' &&
    channelOf(value.channel) === value.channel
  )
}

export function isTask(value: unknown): value is Task {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.text === 'string' &&
    typeof value.isFresh === 'boolean' &&
    typeof value.sentAt === 'number'
  )
}

export function isAnswer(value: unknown): value is Answer {
  return isRecord(value) && typeof value.id === 'string' && typeof value.text === 'string' && typeof value.finishedAt === 'number'
}

export function isPresence(value: unknown): value is Presence {
  return (
    isRecord(value) &&
    typeof value.sessionId === 'string' &&
    (value.busySince === null || typeof value.busySince === 'number') &&
    typeof value.seenAt === 'number'
  )
}
