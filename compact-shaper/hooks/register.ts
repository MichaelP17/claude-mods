import type { Register } from 'claude-code'

import { pruneTranscript } from './prune'
import type { Decision, Outcome } from './prune'

// A prune that saves less than this is not worth rewriting the transcript.
const MIN_REDUCTION = 0.1

export const HANDOFF_INSTRUCTIONS =
  'Write the summary as a handoff the rest of this session continues from without asking anything. Cover, in this order: the goal; the current state, including the branch and what is done, committed or still open; decisions with their reasons; approaches that were rejected and why; open points; the exact next step; the files to read first. Quote the requirements and corrections the user gave word for word. Leave out anything that can be re-read from the code or the repository.'

let preserveRecentMessages = 6
let keepHeadChars = 300

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens)
}

function reductionOf(outcome: Outcome): number {
  return outcome.tokensBefore === 0 ? 0 : 1 - outcome.tokensAfter / outcome.tokensBefore
}

function reportOf(outcome: Outcome, verb: string): string {
  const cut = outcome.decisions.filter(i => i.reason === 'cut' || i.reason === 'superseded')
  const kept = outcome.decisions.filter(i => i.reason === 'protected')
  const line = (decision: Decision) =>
    `- ${decision.tool} ${decision.input.slice(0, 80)} (${decision.resultChars} chars, ${decision.reason})`
  const largest = [...cut].sort((a, b) => b.resultChars - a.resultChars).slice(0, 8)
  const lines = [
    `prune ${verb}: ${formatTokens(outcome.tokensBefore)} → ${formatTokens(outcome.tokensAfter)} (−${Math.round(reductionOf(outcome) * 100)}%) · ${cut.length} outputs cut`,
  ]
  if (largest.length > 0) {
    lines.push('Largest cuts:', ...largest.map(line))
  }
  if (kept.length > 0) {
    lines.push('Protected:', ...kept.map(line))
  }

  return lines.join('\n')
}

export const register: Register = (on, options) => {
  preserveRecentMessages = Number(options.preserveRecentMessages ?? 6)
  keepHeadChars = Number(options.keepHeadChars ?? 300)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'prune-preview',
      description: 'Show what /compact prune would cut from this conversation, without changing it',
    })

    return next(e)
  })

  on('command.run', { command: 'prune-preview' }, async $ => {
    const usage = await $.session.usage()
    const messages = await $.session.messages()
    const outcome = pruneTranscript(messages, usage.context.tokens ?? 0, preserveRecentMessages, keepHeadChars)

    return { text: reportOf(outcome, 'preview') }
  })

  // `/compact prune` cuts re-readable tool output instead of summarizing. It
  // rides on /compact because `$.session.compact()` skips the calling plugin's
  // own hook and may not run from a command hook at all.
  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }
    if (e.trigger === 'manual' && e.instructions?.trim().toLowerCase() === 'prune') {
      const usage = await $.session.usage()
      const outcome = pruneTranscript(e.messages, usage.context.tokens ?? 0, preserveRecentMessages, keepHeadChars)
      if (reductionOf(outcome) < MIN_REDUCTION) {
        return { skip: `prune: nothing worth cutting (−${Math.round(reductionOf(outcome) * 100)}%)` }
      }
      $.ui.toast(reportOf(outcome, 'applied').split('\n')[0] ?? '', { timeoutMs: 15_000 })

      return { messages: outcome.messages, tokensBefore: outcome.tokensBefore, tokensAfter: outcome.tokensAfter }
    }
    const instructions = e.instructions === undefined ? HANDOFF_INSTRUCTIONS : `${HANDOFF_INSTRUCTIONS}\n\n${e.instructions}`

    return next({ ...e, instructions })
  })
}
