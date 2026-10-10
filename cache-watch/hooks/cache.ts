import type { CacheReading, Footer } from '../types'

export const SHORT_TTL_MS = 5 * 60 * 1000

// Below this prompt size a cache miss says nothing about the TTL: the prefix
// may simply be too short to be cached at all.
const MIN_LEARNING_TOKENS = 20_000

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export function promptTokensOf(usage: Usage): number {
  return usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
}

export function contextTokensOf(usage: Usage): number {
  return promptTokensOf(usage) + usage.output_tokens
}

export function remainingMs(reading: CacheReading, now: number): number | null {
  if (reading.lastRequestAt === null) {
    return null
  }

  return Math.max(0, reading.lastRequestAt + reading.ttlMs - now)
}

export function isCold(reading: CacheReading, now: number): boolean {
  return remainingMs(reading, now) === 0
}

// The server is the only one who knows the real TTL. A request that found
// nothing cached although the timer still ran means a shorter lifetime (usage
// overage drops it to five minutes); one served after more than five minutes
// means the configured lifetime holds again.
export function learnTtl(reading: CacheReading, startedAt: number, usage: Usage, configuredTtlMs: number): number {
  if (reading.lastRequestAt === null || reading.isRebuildPending) {
    return reading.ttlMs
  }
  const prompt = promptTokensOf(usage)
  if (prompt < MIN_LEARNING_TOKENS) {
    return reading.ttlMs
  }
  const gap = startedAt - reading.lastRequestAt
  const wasServed = usage.cache_read_input_tokens >= prompt * 0.5
  if (!wasServed && gap > SHORT_TTL_MS && gap < reading.ttlMs) {
    return SHORT_TTL_MS
  }
  if (wasServed && gap > reading.ttlMs) {
    return configuredTtlMs
  }

  return reading.ttlMs
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  }
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}k`
  }

  return String(tokens)
}

export function formatRemaining(ms: number): string {
  return ms < 60_000 ? '<1m' : `${Math.floor(ms / 60_000)}m`
}

export type Visibility = { fromTokens: number; warnMs: number }

// The countdown only earns its place when there is something to decide: a
// large context, or a cache about to go cold. After a compaction the next
// request rebuilds the cache anyway, so there is nothing to count down.
export function footerOf(reading: CacheReading, now: number, visibility: Visibility): Footer | null {
  const remaining = remainingMs(reading, now)
  if (remaining === null || reading.isRebuildPending) {
    return null
  }
  const isExpiring = remaining > 0 && remaining <= visibility.warnMs
  if (reading.contextTokens < visibility.fromTokens && !isExpiring) {
    return null
  }
  if (remaining === 0) {
    return { label: '🧊 cold', isExpiring: false }
  }

  return { label: `⏳ ${formatRemaining(remaining)}`, isExpiring }
}

const COMMIT = /\bgit\s+(?:-C\s+\S+\s+)?commit\b/
const TESTS = /\b(?:dotnet\s+test|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test|pytest|go\s+test|cargo\s+test|vitest|jest|mvn\s+test|gradle\s+test|claude\s+plugin\s+test)\b/

// A turn that committed or ran tests green ends a unit of work: compacting
// there loses nothing that is still in flight.
export function isMilestoneCommand(command: string): boolean {
  return COMMIT.test(command) || TESTS.test(command)
}

export const HANDOFF_FILE = 'HANDOFF.md'

export const HANDOFF_PROMPT =
  'Write HANDOFF.md at the repository root so a new session can continue from it alone: date and branch, the goal, the current state, decisions and their reasons, approaches that were rejected and why, open points, the exact next step and which files to read first. Replace what an older handoff says. Leave out anything that can be re-read from the code.'

export function handoffContextOf(path: string): string {
  return `The previous session left a handoff in ${path}. When the person asks to continue without saying with what, read it first and check that branch and recent commits still match it.`
}
