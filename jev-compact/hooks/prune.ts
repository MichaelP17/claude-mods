import type { SessionMessage, ToolResultSummary, ToolUseSummary } from 'claude-code'

export type Call = {
  id: string
  toolUseId: string
  tool: string
  input: Readonly<Record<string, unknown>>
  callIndex: number
  resultText: string
  isError: boolean
  isPinned: boolean
}

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const WRITE_FIELDS = new Set(['content', 'new_string', 'old_string', 'new_source', 'edits'])

export function isPinned(index: number, total: number, preserveRecentMessages: number): boolean {
  return index === 0 || index >= total - preserveRecentMessages
}

export function collectCalls(messages: readonly SessionMessage[], preserveRecentMessages: number): Call[] {
  const results = new Map<string, { index: number; result: ToolResultSummary }>()
  messages.forEach((message, index) => {
    for (const result of message.toolResults ?? []) {
      results.set(result.tool_use_id, { index, result })
    }
  })
  const calls: Call[] = []
  messages.forEach((message, callIndex) => {
    for (const use of message.toolUses) {
      const found = results.get(use.tool_use_id)
      const resultText = found?.result.text ?? use.text
      if (resultText === undefined) {
        continue
      }
      const resultIndex = found?.index ?? callIndex
      calls.push({
        id: `t${calls.length + 1}`,
        toolUseId: use.tool_use_id,
        tool: use.tool,
        input: use.input,
        callIndex,
        resultText,
        isError: found?.result.isError ?? use.isError === true,
        isPinned:
          isPinned(callIndex, messages.length, preserveRecentMessages) ||
          isPinned(resultIndex, messages.length, preserveRecentMessages),
      })
    }
  })

  return calls
}

function pathOf(call: Call): string | undefined {
  const path = call.input.file_path ?? call.input.notebook_path

  return typeof path === 'string' ? path : undefined
}

function isFullRead(call: Call): boolean {
  return call.tool === 'Read' && call.input.offset === undefined && call.input.limit === undefined
}

// A Read result is outdated once the same file was written, and redundant once
// it was read again in full. The file on disk stays the source of truth.
export function supersededReads(calls: readonly Call[]): Set<string> {
  const superseded = new Set<string>()
  calls.forEach((call, index) => {
    const path = pathOf(call)
    if (call.tool !== 'Read' || call.isPinned || path === undefined) {
      return
    }
    const isReplaced = calls
      .slice(index + 1)
      .some(i => pathOf(i) === path && (WRITE_TOOLS.has(i.tool) || isFullRead(i)))
    if (isReplaced) {
      superseded.add(call.id)
    }
  })

  return superseded
}

function shortened(text: string, headChars: number, note: string): string {
  if (text.length <= headChars + 200) {
    return text
  }

  return `${text.slice(0, headChars)}\n[jev-compact removed ${text.length - headChars} chars; ${note}]`
}

export function truncateResult(text: string, headChars: number, tool: string): string {
  return shortened(text, headChars, `run ${tool} again if the content is needed`)
}

function shrinkValue(value: unknown, headChars: number): unknown {
  if (typeof value === 'string') {
    return shortened(value, headChars, 'the file on disk holds the current content')
  }
  if (Array.isArray(value)) {
    return value.map(i => shrinkValue(i, headChars))
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shrinkValue(inner, headChars)]))
  }

  return value
}

// What an edit wrote is on disk; the transcript only needs to show that it
// happened and roughly what it touched.
export function shrinkWriteInput(
  tool: string,
  input: Readonly<Record<string, unknown>>,
  headChars: number,
): Record<string, unknown> | null {
  if (!WRITE_TOOLS.has(tool)) {
    return null
  }
  const shrunk = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, WRITE_FIELDS.has(key) ? shrinkValue(value, headChars) : value]),
  )

  return JSON.stringify(shrunk) === JSON.stringify(input) ? null : shrunk
}

function rebuiltUse(use: ToolUseSummary, text: string | undefined, input: Record<string, unknown> | null): ToolUseSummary {
  const copy: ToolUseSummary = { tool_use_id: use.tool_use_id, tool: use.tool, input: input ?? use.input }
  if (text !== undefined) {
    copy.text = text
  }
  if (use.isError === true) {
    copy.isError = true
  }

  return copy
}

/**
 * Rebuilds the transcript with the dropped results cut to their head and the
 * write inputs of unpinned calls shrunk. Messages left untouched are returned
 * as the same objects, so they keep the engine's handle.
 */
export function applyDrops(
  messages: readonly SessionMessage[],
  calls: readonly Call[],
  dropped: ReadonlySet<string>,
  headChars: number,
): SessionMessage[] {
  const byToolUseId = new Map(calls.map(i => [i.toolUseId, i]))
  const isDropped = (toolUseId: string) => {
    const call = byToolUseId.get(toolUseId)

    return call !== undefined && dropped.has(call.id)
  }
  const shrinkable = (use: ToolUseSummary) => {
    const call = byToolUseId.get(use.tool_use_id)

    return call !== undefined && !call.isPinned ? shrinkWriteInput(use.tool, use.input, headChars) : null
  }

  return messages.map(message => {
    const uses = message.toolUses.map(use => {
      const input = shrinkable(use)
      const text = isDropped(use.tool_use_id) && use.text !== undefined ? truncateResult(use.text, headChars, use.tool) : use.text
      if (input === null && text === use.text) {
        return use
      }

      return rebuiltUse(use, text, input)
    })
    const results = (message.toolResults ?? []).map(result => {
      if (!isDropped(result.tool_use_id)) {
        return result
      }
      const tool = byToolUseId.get(result.tool_use_id)?.tool ?? 'the tool'
      const text = truncateResult(result.text, headChars, tool)

      return text === result.text ? result : { tool_use_id: result.tool_use_id, text, isError: result.isError }
    })
    const isTouched =
      uses.some((use, index) => use !== message.toolUses[index]) ||
      results.some((result, index) => result !== message.toolResults?.[index])
    if (!isTouched) {
      return message
    }
    const rebuilt: SessionMessage = { role: message.role, text: message.text, toolUses: uses }
    if (message.toolResults !== undefined) {
      rebuilt.toolResults = results
    }

    return rebuilt
  })
}

export function charsOf(messages: readonly SessionMessage[]): number {
  const hasResultRows = messages.some(i => (i.toolResults ?? []).length > 0)
  let total = 0
  for (const message of messages) {
    total += message.text.length
    for (const use of message.toolUses) {
      total += JSON.stringify(use.input).length
      if (!hasResultRows) {
        total += use.text?.length ?? 0
      }
    }
    for (const result of message.toolResults ?? []) {
      total += result.text.length
    }
  }

  return total
}
