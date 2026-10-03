export const REASON_PREFIX = 'Over-limit reason:'

export type Kind = 'subagents' | 'monitors'

const NUMBER_WORDS: Record<string, number> = {
  zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12,
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
}

const COUNT = `(\\d+|${Object.keys(NUMBER_WORDS).join('|')})`

// "Nutze 8 Subagents", "starte fünf Subagenten", "use up to six agents" — a
// count directly before the noun, optionally with "parallel" in between.
const REQUEST_PATTERNS: Record<Kind, RegExp> = {
  subagents: new RegExp(`(?<![\\p{L}\\d])${COUNT}\\s+(?:parallele?n?\\s+|parallel\\s+)?(?:sub-?agent(?:s|en)?|agent(?:s|en)?)(?![\\p{L}])`, 'iu'),
  monitors: new RegExp(`(?<![\\p{L}\\d])${COUNT}\\s+(?:parallele?n?\\s+|parallel\\s+)?monitor(?:s|e|en)?(?![\\p{L}])`, 'iu'),
}

export function requestedLimits(text: string): Partial<Record<Kind, number>> {
  const limits: Partial<Record<Kind, number>> = {}
  for (const kind of ['subagents', 'monitors'] as const) {
    const match = REQUEST_PATTERNS[kind].exec(text)
    const token = match?.[1]?.toLowerCase()
    const value = token === undefined ? Number.NaN : (NUMBER_WORDS[token] ?? Number(token))
    if (Number.isInteger(value) && value > 0) {
      limits[kind] = value
    }
  }

  return limits
}

export type Reasoned = { reason: string | null; rest: string }

// Subagents carry the reason as the first line of their prompt.
export function takeReasonLine(prompt: string): Reasoned {
  const [first = '', ...others] = prompt.split('\n')
  if (!first.trim().startsWith(REASON_PREFIX)) {
    return { reason: null, rest: prompt }
  }

  return { reason: first.trim().slice(REASON_PREFIX.length).trim(), rest: others.join('\n').replace(/^\n+/, '') }
}

// Monitors carry it in their one-line description: "Over-limit reason: <why> | <description>".
export function takeReasonPrefix(description: string): Reasoned {
  const trimmed = description.trim()
  if (!trimmed.startsWith(REASON_PREFIX)) {
    return { reason: null, rest: description }
  }
  const body = trimmed.slice(REASON_PREFIX.length)
  const separator = body.lastIndexOf('|')
  if (separator === -1) {
    return { reason: body.trim(), rest: body.trim() }
  }

  return { reason: body.slice(0, separator).trim(), rest: body.slice(separator + 1).trim() }
}

export type TaskEnd = { taskId: string; status: string }

// Background tasks report their end as a <task-notification> delivered like a prompt.
export function parseTaskEnds(text: string): TaskEnd[] {
  const ends: TaskEnd[] = []
  const pattern = /<task-notification>([\s\S]*?)<\/task-notification>/g
  for (const match of text.matchAll(pattern)) {
    const body = match[1] ?? ''
    const taskId = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(body)?.[1]
    const status = /<status>\s*([^<\s]+)\s*<\/status>/.exec(body)?.[1]
    if (taskId !== undefined && status !== undefined && ['completed', 'failed', 'killed', 'stopped', 'timeout'].includes(status)) {
      ends.push({ taskId, status })
    }
  }

  return ends
}
