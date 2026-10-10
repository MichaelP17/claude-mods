import { expect, test } from 'claude-code/testing'

import type { CacheReading } from '../types'
import { SHORT_TTL_MS, footerOf, formatTokens, isCold, isMilestoneCommand, learnTtl, remainingMs } from './cache'

const HOUR = 60 * 60 * 1000
const MINUTE = 60 * 1000

function readingAt(lastRequestAt: number | null, extra: Partial<CacheReading> = {}): CacheReading {
  return { lastRequestAt, ttlMs: HOUR, contextTokens: 380_000, isRebuildPending: false, ...extra }
}

function usage(read: number, written: number) {
  return { input_tokens: 10, output_tokens: 500, cache_read_input_tokens: read, cache_creation_input_tokens: written }
}

test('the lifetime counts from the last request and ends cold', () => {
  const reading = readingAt(0)
  expect(remainingMs(reading, 18 * MINUTE)).toBe(42 * MINUTE)
  expect(isCold(reading, 59 * MINUTE)).toBe(false)
  expect(isCold(reading, HOUR)).toBe(true)
  expect(remainingMs(readingAt(null), 0)).toBe(null)
})

const VISIBILITY = { fromTokens: 100_000, warnMs: 10 * MINUTE }

test('the footer counts the minutes down and turns cold', () => {
  expect(footerOf(readingAt(null), 0, VISIBILITY)).toBe(null)
  expect(footerOf(readingAt(0), 18 * MINUTE, VISIBILITY)).toEqual({ label: '⏳ 42m', isExpiring: false })
  expect(footerOf(readingAt(0), 55 * MINUTE, VISIBILITY)).toEqual({ label: '⏳ 5m', isExpiring: true })
  expect(footerOf(readingAt(0), HOUR - 30_000, VISIBILITY)).toEqual({ label: '⏳ <1m', isExpiring: true })
  expect(footerOf(readingAt(0), 2 * HOUR, VISIBILITY)).toEqual({ label: '🧊 cold', isExpiring: false })
  expect(footerOf(readingAt(0, { isRebuildPending: true }), MINUTE, VISIBILITY)).toBe(null)
  expect(formatTokens(1_200_000)).toBe('1.2M')
  expect(formatTokens(800)).toBe('800')
})

test('a small context shows only while the cache is about to expire', () => {
  const small = readingAt(0, { contextTokens: 40_000 })
  expect(footerOf(small, 18 * MINUTE, VISIBILITY)).toBe(null)
  expect(footerOf(small, 55 * MINUTE, VISIBILITY)).toEqual({ label: '⏳ 5m', isExpiring: true })
  expect(footerOf(small, 2 * HOUR, VISIBILITY)).toBe(null)
})

test('a miss while the timer still ran teaches the short lifetime', () => {
  const reading = readingAt(0)
  expect(learnTtl(reading, 20 * MINUTE, usage(0, 300_000), HOUR)).toBe(SHORT_TTL_MS)
  expect(learnTtl(reading, 20 * MINUTE, usage(299_000, 1000), HOUR)).toBe(HOUR)
  expect(learnTtl(reading, 3 * MINUTE, usage(0, 300_000), HOUR)).toBe(HOUR)
})

test('a hit after the short lifetime restores the configured one', () => {
  const reading = readingAt(0, { ttlMs: SHORT_TTL_MS })
  expect(learnTtl(reading, 20 * MINUTE, usage(299_000, 1000), HOUR)).toBe(HOUR)
})

test('small prompts and pending rebuilds teach nothing', () => {
  expect(learnTtl(readingAt(0), 20 * MINUTE, usage(0, 5000), HOUR)).toBe(HOUR)
  expect(learnTtl(readingAt(0, { isRebuildPending: true }), 20 * MINUTE, usage(0, 300_000), HOUR)).toBe(HOUR)
})

test('commits and test runs count as milestones', () => {
  expect(isMilestoneCommand('git commit -m "Fix parser"')).toBe(true)
  expect(isMilestoneCommand('git -C ~/Projects/app commit -am wip')).toBe(true)
  expect(isMilestoneCommand('dotnet test --no-build')).toBe(true)
  expect(isMilestoneCommand('npm run test -- --watch=false')).toBe(true)
  expect(isMilestoneCommand('git status')).toBe(false)
  expect(isMilestoneCommand('cat test.txt')).toBe(false)
})
