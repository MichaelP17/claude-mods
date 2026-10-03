import type { SessionMessage } from 'claude-code'

import { isPinned } from './prune'
import type { Call } from './prune'

export type Provider = 'openrouter' | 'typesafe'

// Both serve the same System One API; OpenRouter bills through its own account.
export const ENDPOINTS: Record<Provider, { url: string; model: string }> = {
  openrouter: { url: 'https://openrouter.ai/api/v1/systemone', model: '~typesafe/jev-latest' },
  typesafe: { url: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest' },
}

export const JEV_USD_PER_MILLION = 0.042

// Jev reads at most about 32k tokens per request; the state is sent whole with
// every batch of questions, so it gets the larger share.
export const MAX_STATE_TOKENS = 25_000
export const MAX_REQUEST_TOKENS = 30_000

const CONTEXT =
  'A coding assistant conversation is being compacted to free context. `history` is the conversation so far, oldest first. Each tool call shows its input and a short preview of its output; long texts may be abridged. Every question asks whether the full output of one tool call must stay in the history verbatim. An output that is not kept is cut to its first lines; the assistant can re-run the tool or re-read the file whenever it needs the content again, so only outputs that cannot be recovered that way, or that the next steps clearly depend on word for word, need to stay.'

export type HttpFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; ok: boolean; text: string }>

export type JevQuestion = { type: 'noul'; instructions: string }

export type JevReply = { answers: Map<string, number>; inputTokens: number; costUsd: number | null }

export type Asker = (state: object, questions: Record<string, JevQuestion>) => Promise<JevReply>

// Conservative for JSON-heavy text, so a state never overruns Jev's limit.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3)
}

const SENSITIVE_PATH = /(^|\/)(\.env(\.|$)|[^/]*\.pem$|id_(rsa|ed25519|ecdsa)|credentials|secrets?\.)/i
const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_\w{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[\w-]{10,})/g,
]
const SECRET_ASSIGNMENT = /\b(password|passwd|secret|token|api[_-]?key)(\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi

export function redact(text: string): string {
  let result = text
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, '[redacted]')
  }

  return result.replace(SECRET_ASSIGNMENT, '$1$2[redacted]')
}

export function isSensitive(call: Call): boolean {
  const path = call.input.file_path ?? call.input.path

  return typeof path === 'string' && SENSITIVE_PATH.test(path)
}

function abridge(text: string, limit: number): string {
  if (text.length <= limit) {
    return text
  }
  const head = Math.ceil(limit * 0.7)
  const tail = limit - head

  return `${text.slice(0, head)} […${text.length - limit} chars…] ${tail > 0 ? text.slice(-tail) : ''}`
}

// `preview: -1` means the configured preview length.
type Level = { preview: number; input: number; text: number; pinnedText: number }

const LEVELS: readonly Level[] = [
  { preview: -1, input: 400, text: 4000, pinnedText: 8000 },
  { preview: 120, input: 200, text: 1200, pinnedText: 4000 },
  { preview: 0, input: 100, text: 300, pinnedText: 2000 },
  { preview: 0, input: 60, text: 80, pinnedText: 800 },
]

type Entry = { i: number; role: string; text: string; tool_calls?: string[] }

function callLine(call: Call, level: Level, previewChars: number, decided: ReadonlySet<string>): string {
  const input = abridge(redact(JSON.stringify(call.input)), level.input)
  const status = `${call.isError ? 'error' : 'ok'}, ${call.resultText.length} chars`
  if (decided.has(call.id)) {
    return `${call.id} ${call.tool} ${input} → ${status}, already cut`
  }
  const previewLength = level.preview === -1 ? previewChars : Math.min(level.preview, previewChars)
  const preview =
    previewLength > 0 && !isSensitive(call)
      ? `: ${redact(call.resultText.slice(0, previewLength)).replace(/\s+/g, ' ')}`
      : ''

  return `${call.id} ${call.tool} ${input} → ${status}${preview}`
}

export function goalOf(messages: readonly SessionMessage[]): string {
  return messages
    .filter(i => i.role === 'user' && i.text.trim().length > 0 && (i.toolResults ?? []).length === 0)
    .slice(-3)
    .map(i => abridge(redact(i.text), 500))
    .join('\n')
}

/**
 * The conversation as Jev reads it, shrunk level by level until it fits:
 * output previews, tool inputs and texts get shorter, and as a last resort
 * old messages without a candidate call are left out, oldest first.
 */
export function buildState(
  messages: readonly SessionMessage[],
  calls: readonly Call[],
  candidates: ReadonlySet<string>,
  decided: ReadonlySet<string>,
  previewChars: number,
  preserveRecentMessages: number,
): { state: object; tokens: number } {
  const goal = goalOf(messages)
  const byMessage = new Map<number, Call[]>()
  for (const call of calls) {
    byMessage.set(call.callIndex, [...(byMessage.get(call.callIndex) ?? []), call])
  }
  const pinned = (index: number) => isPinned(index, messages.length, preserveRecentMessages)
  const sized = (history: Entry[]) => {
    const state = { context: CONTEXT, goal, history }

    return { state, tokens: estimateTokens(JSON.stringify(state)) }
  }

  let history: Entry[] = []
  for (const level of LEVELS) {
    history = []
    messages.forEach((message, index) => {
      const own = byMessage.get(index) ?? []
      if (message.text.trim().length === 0 && own.length === 0) {
        return
      }
      const entry: Entry = {
        i: index,
        role: message.role,
        text: abridge(redact(message.text), pinned(index) ? level.pinnedText : level.text),
      }
      if (own.length > 0) {
        entry.tool_calls = own.map(i => callLine(i, level, previewChars, decided))
      }
      history.push(entry)
    })
    const fitted = sized(history)
    if (fitted.tokens <= MAX_STATE_TOKENS) {
      return fitted
    }
  }

  const holdsCandidate = (entry: Entry) => (byMessage.get(entry.i) ?? []).some(i => candidates.has(i.id))
  let fitted = sized(history)
  while (fitted.tokens > MAX_STATE_TOKENS) {
    const removable = history.findIndex(i => !pinned(i.i) && !holdsCandidate(i))
    if (removable === -1) {
      throw new Error(`conversation too large for Jev (~${fitted.tokens} tokens of ${MAX_STATE_TOKENS})`)
    }
    history = history.filter((_, index) => index !== removable)
    fitted = sized(history)
  }

  return fitted
}

export function questionFor(call: Call): Record<string, JevQuestion> {
  return {
    [`keep_${call.id}`]: {
      type: 'noul',
      instructions: `The full output of tool call ${call.id} (${call.tool}, ${call.resultText.length} chars) must stay in the history verbatim: the next steps depend on its exact contents and re-running the tool would not give them back`,
    },
  }
}

export function batchesOf(calls: readonly Call[], stateTokens: number): Call[][] {
  const budget = MAX_REQUEST_TOKENS - stateTokens - 50
  const batches: Call[][] = []
  let current: Call[] = []
  let used = 0
  for (const call of calls) {
    const tokens = estimateTokens(JSON.stringify(questionFor(call)))
    if (tokens > budget) {
      throw new Error('the state leaves no room for questions')
    }
    if (used + tokens > budget) {
      batches.push(current)
      current = []
      used = 0
    }
    current.push(call)
    used += tokens
  }
  if (current.length > 0) {
    batches.push(current)
  }

  return batches
}

export function jevAsker(fetch: HttpFetch, provider: Provider, apiKey: string): Asker {
  const endpoint = ENDPOINTS[provider]

  return async (state, questions) => {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: endpoint.model, state, questions }),
    })
    if (!response.ok) {
      throw new Error(`Jev answered ${response.status}: ${response.text.slice(0, 200)}`)
    }
    const parsed = JSON.parse(response.text) as {
      answers?: Record<string, { noul?: unknown }>
      usage?: { input_tokens?: number; cost?: unknown }
    }
    const answers = new Map<string, number>()
    for (const name of Object.keys(questions)) {
      const value = parsed.answers?.[name]?.noul
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Jev gave no probability for ${name}`)
      }
      answers.set(name, value)
    }

    const cost = parsed.usage?.cost

    return {
      answers,
      inputTokens: parsed.usage?.input_tokens ?? estimateTokens(JSON.stringify({ state, questions })),
      costUsd: typeof cost === 'number' && Number.isFinite(cost) ? cost : null,
    }
  }
}
