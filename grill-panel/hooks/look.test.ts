import { expect, test } from 'claude-code/testing'

import { fitText, headerSvg, textWidth, wrapText } from './look'

test('a title too wide for one line wraps, and past the last line it is cut with an ellipsis', async () => {
  const title = 'Where should the answers go once every question of the round has been answered'
  const width = textWidth('Where should the answers go', 17, true)
  const lines = wrapText(title, width, 17, 2, true)

  expect(lines).toHaveLength(2)
  expect(lines[0]).toBe('Where should the answers go')
  expect(lines[1]?.endsWith('…')).toBe(true)
  for (const line of lines) {
    expect(textWidth(line, 17, true)).toBeLessThanOrEqual(width)
  }
  expect(wrapText('Short', 300, 17, 2)).toEqual(['Short'])
  expect(fitText('Short', 300, 12)).toBe('Short')
})

test('the header card draws one segment per question and escapes its text', async () => {
  const card = headerSvg({
    width: 400,
    eyebrow: 'QUESTION 2 OF 4',
    title: 'Tags <and> "items" & more',
    counter: '1/4 answered',
    segments: ['answered', 'current', 'skipped', 'open'],
  })

  expect(card.source.match(/<rect class="(answered|current|skipped|open)"/gu)).toHaveLength(4)
  expect(card.source).toContain('Tags &lt;and&gt; &quot;items&quot; &amp; more')
  expect(card.source).toContain(`height="${card.height}"`)

  const long = headerSvg({ width: 400, eyebrow: 'REVIEW', title: 'word '.repeat(40), counter: '4/4 answered', segments: [] })
  expect(long.height).toBeGreaterThan(card.height)
})
