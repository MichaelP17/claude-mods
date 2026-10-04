import type { SessionMessage } from 'claude-code'

import { JEV_USD_PER_MILLION, batchesOf, buildState, questionFor } from './jev'
import type { Asker } from './jev'
import { applyDrops, charsOf, collectCalls, supersededReads } from './prune'
import type { Call } from './prune'

export type Settings = {
  keepThreshold: number
  aggressiveThreshold: number
  preserveRecentMessages: number
  targetTokens: number
  sufficientReduction: number
  previewChars: number
  keepHeadChars: number
}

export type Stage = 'rules' | 'jev' | 'jev-aggressive'

export type Decision = {
  id: string
  tool: string
  input: string
  resultChars: number
  probability: number | null
  reason: 'pinned' | 'superseded' | 'kept' | 'cut' | 'short'
}

export type Outcome = {
  messages: SessionMessage[]
  stage: Stage
  tokensBefore: number
  tokensAfter: number
  isOnTarget: boolean
  isSufficient: boolean
  decisions: Decision[]
  jevRequests: number
  jevTokens: number
  jevCostUsd: number
  jevError: string | null
}

function dropSet(
  superseded: ReadonlySet<string>,
  candidates: readonly Call[],
  probabilities: ReadonlyMap<string, number>,
  threshold: number,
): Set<string> {
  const dropped = new Set(superseded)
  for (const call of candidates) {
    const probability = probabilities.get(call.id)
    if (probability !== undefined && probability < threshold) {
      dropped.add(call.id)
    }
  }

  return dropped
}

function decisionsOf(
  calls: readonly Call[],
  superseded: ReadonlySet<string>,
  candidateIds: ReadonlySet<string>,
  probabilities: ReadonlyMap<string, number>,
  dropped: ReadonlySet<string>,
): Decision[] {
  return calls.map(call => {
    const reason = call.isPinned
      ? 'pinned'
      : superseded.has(call.id)
        ? 'superseded'
        : !candidateIds.has(call.id)
          ? 'short'
          : dropped.has(call.id)
            ? 'cut'
            : 'kept'

    return {
      id: call.id,
      tool: call.tool,
      input: JSON.stringify(call.input).slice(0, 160),
      resultChars: call.resultText.length,
      probability: probabilities.get(call.id) ?? null,
      reason,
    }
  })
}

/**
 * Cuts the transcript in stages, each only when the one before missed the
 * target: local rules alone, then Jev's verdicts at the normal threshold, then
 * at the aggressive one. Without an asker, or when Jev fails, the rules stand
 * alone. Text messages are never touched.
 */
export async function pruneTranscript(
  messages: readonly SessionMessage[],
  tokensBefore: number,
  settings: Settings,
  ask: Asker | null,
): Promise<Outcome> {
  const calls = collectCalls(messages, settings.preserveRecentMessages)
  const superseded = supersededReads(calls)
  const candidates = calls.filter(
    i => !i.isPinned && !superseded.has(i.id) && i.resultText.length > settings.keepHeadChars + 200,
  )
  const candidateIds = new Set(candidates.map(i => i.id))
  const charsBefore = Math.max(1, charsOf(messages))
  const tokensOf = (list: readonly SessionMessage[]) => Math.round((tokensBefore * charsOf(list)) / charsBefore)

  const probabilities = new Map<string, number>()
  let jevRequests = 0
  let jevTokens = 0
  let jevCostUsd = 0
  let jevError: string | null = null

  let dropped = new Set(superseded)
  let pruned = applyDrops(messages, calls, dropped, settings.keepHeadChars)
  let stage: Stage = 'rules'

  if (ask !== null && candidates.length > 0 && tokensOf(pruned) > settings.targetTokens) {
    try {
      const { state, tokens } = buildState(
        messages,
        calls,
        candidateIds,
        superseded,
        settings.previewChars,
        settings.preserveRecentMessages,
      )
      const replies = await Promise.all(
        batchesOf(candidates, tokens).map(batch => ask(state, Object.assign({}, ...batch.map(questionFor)))),
      )
      for (const reply of replies) {
        jevRequests += 1
        jevTokens += reply.inputTokens
        jevCostUsd += reply.costUsd ?? (reply.inputTokens * JEV_USD_PER_MILLION) / 1_000_000
        for (const [name, probability] of reply.answers) {
          probabilities.set(name.replace(/^keep_/, ''), probability)
        }
      }
      dropped = dropSet(superseded, candidates, probabilities, settings.keepThreshold)
      pruned = applyDrops(messages, calls, dropped, settings.keepHeadChars)
      stage = 'jev'
      if (tokensOf(pruned) > settings.targetTokens && settings.aggressiveThreshold > settings.keepThreshold) {
        dropped = dropSet(superseded, candidates, probabilities, settings.aggressiveThreshold)
        pruned = applyDrops(messages, calls, dropped, settings.keepHeadChars)
        stage = 'jev-aggressive'
      }
    } catch (error) {
      jevError = error instanceof Error ? error.message : String(error)
    }
  }

  const tokensAfter = tokensOf(pruned)
  const isOnTarget = tokensAfter <= settings.targetTokens
  const reduction = tokensBefore === 0 ? 0 : 1 - tokensAfter / tokensBefore

  return {
    messages: pruned,
    stage,
    tokensBefore,
    tokensAfter,
    isOnTarget,
    isSufficient: isOnTarget || reduction >= settings.sufficientReduction,
    decisions: decisionsOf(calls, superseded, candidateIds, probabilities, dropped),
    jevRequests,
    jevTokens,
    jevCostUsd,
    jevError,
  }
}
