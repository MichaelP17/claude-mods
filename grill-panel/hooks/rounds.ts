import type { Answer, Question, Round, StoredRound } from '../types'

// Appended to the grilling skill's prompt rather than written into the skill,
// whose file is replaced whenever it is updated from upstream.
export const FORMAT_CONTRACT = `## Answer panel

The grill-panel mod reads each question round from your message, lets the user answer it in a panel, and sends the answers back as \`Q<n>: <answer>\` lines. It only finds questions written exactly like this:

- Every question starts on a line of its own with \`❓ **Q<n>** - **<title>**: <body>\`; no number repeats within one message.
- The recommendation follows on a line of its own starting with \`➡️\` and ends at the next blank line.
- Text after the last recommendation, separated by a blank line, belongs to no question.

An answer of \`Recommendation accepted\` means the user took your recommendation as written. \`(unanswered)\` means the user left that question open: ask it again in a later round if it still matters.`

const HEADER = /^\s*(❓\uFE0F?\s*)?(\*\*)?Q(\d{1,3})(?!\d)(.*)$/u
const RECOMMENDATION = /^\s*➡\uFE0F?\s*/u
const SEPARATOR = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/
const FENCE = /^\s*(```|~~~)/

type Draft = {
  number: number
  title: string
  hasMark: boolean
  body: string[]
  recommendation: string[] | null
  isClosed: boolean
}

export function parseQuestions(text: string): Question[] {
  const drafts: Draft[] = []
  let isInFence = false
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const isCode = isInFence || FENCE.test(line)
    if (FENCE.test(line)) {
      isInFence = !isInFence
    }
    const header = isCode ? undefined : headerOf(line)
    if (header !== undefined) {
      drafts.push(header)
      continue
    }
    const draft = drafts.at(-1)
    if (draft === undefined || draft.isClosed) {
      continue
    }
    if (draft.recommendation !== null) {
      if (!isCode && (line.trim().length === 0 || SEPARATOR.test(line))) {
        draft.isClosed = true
      } else {
        draft.recommendation.push(line)
      }
      continue
    }
    if (!isCode && RECOMMENDATION.test(line)) {
      draft.recommendation = [line.replace(RECOMMENDATION, '')]
      continue
    }
    if (!isCode && SEPARATOR.test(line)) {
      draft.isClosed = true
      continue
    }
    draft.body.push(line)
  }
  // A bold "**Q3**" alone also turns up in ordinary prose; only the question
  // mark or a recommendation makes it a round.
  if (!drafts.some(i => i.hasMark || i.recommendation !== null)) {
    return []
  }

  return drafts.map(i => {
    const recommendation = i.recommendation === null ? '' : i.recommendation.join('\n').trim()

    return {
      number: i.number,
      title: i.title,
      body: i.body.join('\n').trim(),
      recommendation: recommendation.length === 0 ? null : recommendation,
    }
  })
}

// Accepts "❓ **Q1** - **Title**: body" and the variants a model drifts into:
// "**Q2 (updated)** - **Title**", "**Q3 – Title**", "❓ Q4 - Title: body".
function headerOf(line: string): Draft | undefined {
  const match = HEADER.exec(line)
  if (match === null) {
    return undefined
  }
  const [, mark, bold, digits = '', rest = ''] = match
  if (mark === undefined && bold === undefined) {
    return undefined
  }
  let title = ''
  let remainder = rest
  if (bold !== undefined) {
    const end = remainder.indexOf('**')
    if (end !== -1) {
      const inner = stripSeparators(remainder.slice(0, end))
      if (!inner.startsWith('(')) {
        title = inner
      }
      remainder = remainder.slice(end + 2)
    }
  }
  remainder = stripSeparators(remainder)
  if (remainder.startsWith('**')) {
    const end = remainder.indexOf('**', 2)
    if (end !== -1) {
      title = remainder.slice(2, end)
      remainder = stripSeparators(remainder.slice(end + 2))
    }
  } else if (bold === undefined) {
    const colon = remainder.indexOf(':')
    if (colon > 0 && colon <= 80) {
      title = remainder.slice(0, colon)
      remainder = remainder.slice(colon + 1).trim()
    }
  }

  return {
    number: Number(digits),
    title: title.trim().replace(/:$/, '').trim(),
    hasMark: mark !== undefined,
    body: remainder.length > 0 ? [remainder] : [],
    recommendation: null,
    isClosed: false,
  }
}

function stripSeparators(text: string): string {
  return text.replace(/^[\s:\-–—]+/u, '')
}

type TranscriptMessage = { role: 'user' | 'assistant'; text: string }

// The round a resumed conversation ends on: only Claude's last words count, so a
// round the user already answered by hand is not offered again.
export function lastRoundIn(messages: readonly TranscriptMessage[]): Question[] {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role === 'assistant' && message.text.trim().length > 0) {
      return parseQuestions(message.text)
    }
  }

  return []
}

export function latestRoundIn(messages: readonly TranscriptMessage[]): Question[] {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role !== 'assistant') {
      continue
    }
    const questions = parseQuestions(message.text)
    if (questions.length > 0) {
      return questions
    }
  }

  return []
}

// The project root is part of the key, so the same wording asked in two
// projects keeps two sets of answers.
export function roundKeyOf(root: string, questions: readonly Question[]): string {
  return hashOf(JSON.stringify([root, questions.map(i => [i.number, i.title, i.body, i.recommendation])]))
}

// cyrb53: no crypto in the hooks environment, and the key only has to keep
// rounds apart, not resist anyone.
export function hashOf(text: string): string {
  let first = 0xdeadbeef
  let second = 0x41c6ce57
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    first = Math.imul(first ^ code, 2654435761)
    second = Math.imul(second ^ code, 1597334677)
  }
  first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909)
  second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909)

  return (4294967296 * (2097151 & second) + (first >>> 0)).toString(36)
}

export function newRound(key: string, questions: readonly Question[], answers: readonly (Answer | null)[]): Round {
  return resume({
    key,
    questions: [...questions],
    answers: questions.map((_, index) => answers[index] ?? null),
    skipped: questions.map(() => false),
    current: 0,
    mode: 'answer',
    prefill: null,
  })
}

// Back to answering where it makes sense: the question in view while it is
// still open, else the first open one, else the review.
export function resume(round: Round): Round {
  const index = round.answers[round.current] === null ? round.current : round.answers.indexOf(null)

  return index === -1 ? toReview(round) : { ...round, current: index, mode: 'answer', prefill: null }
}

export function answerOf(text: string, question: Question): Answer | null {
  const normalized = text.replace(/\r\n?/g, '\n').trim()
  if (normalized.length > 0) {
    return { kind: 'text', text: normalized }
  }

  return question.recommendation === null ? null : { kind: 'recommendation' }
}

export function answerCurrent(round: Round, text: string): Round {
  const question = round.questions[round.current]
  const answer = question === undefined ? null : answerOf(text, question)
  if (round.mode !== 'answer' || answer === null) {
    return round
  }

  return moveOn({
    ...round,
    answers: round.answers.map((value, index) => (index === round.current ? answer : value)),
    skipped: round.skipped.map((value, index) => (index === round.current ? false : value)),
  })
}

export function skipCurrent(round: Round): Round {
  return moveOn({
    ...round,
    skipped: round.skipped.map((value, index) => (index === round.current ? round.answers[index] === null : value)),
  })
}

export function goBack(round: Round): Round {
  return round.current === 0 ? round : { ...round, current: round.current - 1, mode: 'answer', prefill: null }
}

export function editAt(round: Round, index: number): Round {
  return index < 0 || index >= round.questions.length ? round : { ...round, current: index, mode: 'answer', prefill: null }
}

export function prefillRecommendation(round: Round): Round {
  const recommendation = round.questions[round.current]?.recommendation ?? null

  return recommendation === null ? round : { ...round, prefill: recommendation }
}

// After an answer or a skip the next open question after the current one,
// wrapping around, so skipped questions come back once the rest are done.
function moveOn(round: Round): Round {
  const count = round.questions.length
  for (let step = 1; step < count; step++) {
    const index = (round.current + step) % count
    if (round.answers[index] === null) {
      return { ...round, current: index, mode: 'answer', prefill: null }
    }
  }

  return toReview(round)
}

function toReview(round: Round): Round {
  return { ...round, mode: 'review', prefill: null }
}

export function openCount(round: Round): number {
  return round.answers.filter(i => i === null).length
}

export function footerOf(round: Round): string {
  return `🔥 ${round.questions.length - openCount(round)}/${round.questions.length}`
}

export function formatAnswers(round: Pick<Round, 'questions' | 'answers'>): string {
  return round.questions.map((question, index) => `Q${question.number}: ${answerText(round.answers[index] ?? null)}`).join('\n\n')
}

function answerText(answer: Answer | null): string {
  if (answer === null) {
    return '(unanswered)'
  }

  return answer.kind === 'recommendation' ? 'Recommendation accepted' : answer.text
}

export function previewOf(answer: Answer | null, length = 60): string {
  if (answer === null) {
    return 'unanswered'
  }
  if (answer.kind === 'recommendation') {
    return 'recommendation accepted'
  }
  const [first = ''] = answer.text.split('\n')
  const cut = first.length > length ? `${first.slice(0, length - 1)}…` : first

  return answer.text.includes('\n') && cut === first ? `${cut} …` : cut
}

export function isStoredRound(value: unknown): value is StoredRound {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<StoredRound>

  return (candidate.status === 'open' || candidate.status === 'done') && Array.isArray(candidate.answers) && typeof candidate.updatedAt === 'number'
}
