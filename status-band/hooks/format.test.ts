import { expect, test } from 'claude-code/testing'

import { COLORS, spansOf } from './format'

test('the line reads like C 10% · 5h 74% · W 98%', async () => {
  const spans = spansOf({ contextPercent: 10, fiveHourPercent: 74, sevenDayPercent: 98 })
  expect(spans.map(i => i.text).join('')).toBe('C 10% · 5h 74% · W 98%')
  expect(spans.filter(i => i.color !== undefined).map(i => i.color)).toEqual([COLORS.green, COLORS.yellow, COLORS.red])
})

test('a window without a reading is left out', async () => {
  const spans = spansOf({ contextPercent: 42, fiveHourPercent: null, sevenDayPercent: 12 })
  expect(spans.map(i => i.text).join('')).toBe('C 42% · W 12%')
  expect(spansOf({ contextPercent: null, fiveHourPercent: null, sevenDayPercent: null })).toEqual([])
})
