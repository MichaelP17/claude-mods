import { expect, test } from 'claude-code/testing'

import { clampLines, fitText, parseBlocks, parseInline, plainOf, textWidth, wrapRuns } from './svg'

test('inline Markdown turns into styled runs', async () => {
  expect(parseInline('Use **ViT-B** with `torch` and *care*, see [docs](https://x.y)')).toEqual([
    { text: 'Use ' },
    { text: 'ViT-B', isBold: true },
    { text: ' with ' },
    { text: 'torch', isCode: true },
    { text: ' and ' },
    { text: 'care', isItalic: true },
    { text: ', see ' },
    { text: 'docs', isLink: true },
  ])
  expect(parseInline('snake_case and 2 * 3 * 4 stay')).toEqual([{ text: 'snake_case and 2 * 3 * 4 stay' }])
  expect(plainOf('**Card.** It `shows`')).toBe('Card. It shows')
})

test('blocks: paragraphs join their lines, lists, quotes, headings and code stand apart', async () => {
  const blocks = parseBlocks('First line\nsame paragraph.\n\n- one\n  continued\n- two\n\n> quoted\n\n## Head\n\n```ts\nconst a = 1\n```')

  expect(blocks.map(i => i.kind)).toEqual(['paragraph', 'item', 'item', 'quote', 'heading', 'code'])
  expect(blocks[0]).toEqual({ kind: 'paragraph', runs: [{ text: 'First line same paragraph.' }] })
  expect(blocks[1]).toEqual({ kind: 'item', marker: '•', runs: [{ text: 'one continued' }] })
  expect(blocks[5]).toEqual({ kind: 'code', lines: ['const a = 1'] })
})

test('wrapping keeps every line within the width and the styles of its words', async () => {
  const runs = parseInline('Where should the **answers** go once every question of the round has been answered')
  const width = textWidth('Where should the answers go', 14)
  const lines = wrapRuns(runs, width, 14)

  expect(lines.length).toBeGreaterThan(2)
  for (const line of lines) {
    expect(textWidth(line.map(i => i.text).join('').trimEnd(), 14)).toBeLessThanOrEqual(width + 1)
  }
  expect(lines[0]?.some(i => i.isBold === true && i.text.startsWith('answers'))).toBe(true)

  const clamped = clampLines(lines, 2, width, 14)
  expect(clamped).toHaveLength(2)
  expect(clamped[1]?.at(-1)?.text.endsWith('…')).toBe(true)
  expect(fitText('Short', 300, 12)).toBe('Short')
})

test('a code span keeps the space after it out of the code font', async () => {
  const [line] = wrapRuns(parseInline('`Enter` = save'), 500, 14)

  expect(line).toEqual([{ text: 'Enter', isCode: true }, { text: ' = save' }])
})

test('a word wider than the line is broken by characters', async () => {
  const lines = wrapRuns([{ text: 'x'.repeat(200) }], 100, 14)

  expect(lines.length).toBeGreaterThan(1)
  expect(lines.map(i => i.map(j => j.text).join('')).join('')).toBe('x'.repeat(200))
})
