import { expect, test } from 'claude-code/testing'

import { headerCard, previewCard, questionCards, recommendationCards, reviewCard } from './look'

const QUESTION = {
  number: 1,
  title: 'Day',
  body: 'What is **tomorrow**? (a) A work day (b) A day off (c) Mixed\nIt decides the plan.',
  recommendation: '(a), since it is midweek.',
}

test('the header card draws one segment per question and escapes its text', async () => {
  const card = headerCard({
    width: 400,
    eyebrow: 'QUESTION 2 OF 4',
    title: 'Tags <and> "items" & more',
    counter: '1/4 answered',
    segments: ['answered', 'current', 'skipped', 'open'],
  })

  expect(card.source.match(/<rect class="(answered|current|skipped|open)"/gu)).toHaveLength(4)
  expect(card.source).toContain('Tags &lt;and&gt; &quot;items&quot; &amp; more')
  expect(card.source).toContain(`height="${card.height}"`)
  expect(card.alt).toBe('QUESTION 2 OF 4: Tags <and> "items" & more, 1/4 answered')
})

test('choices are tiles: the recommended one marked until another is picked', async () => {
  const [open] = questionCards(500, QUESTION, null)
  expect(open?.source.match(/class="tile/gu)).toHaveLength(3)
  expect(open?.source).toContain('class="tile-accent"')
  expect(open?.source).toContain('RECOMMENDED')
  expect(open?.source).toContain('It decides the plan.')
  expect(open?.alt).toBe('What is tomorrow? (a) A work day (b) A day off (c) Mixed It decides the plan.')

  const [picked] = questionCards(500, QUESTION, { kind: 'text', text: '(b) A day off' })
  expect(picked?.source).toContain('class="tile-success"')
  expect(picked?.source).not.toContain('class="tile-accent"')
  expect(picked?.source).toContain('YOUR ANSWER')

  const [accepted] = questionCards(500, QUESTION, { kind: 'recommendation' })
  expect(accepted?.source).toContain('class="tile-success"')
})

test('a body taller than an Svg may be goes on in further cards', async () => {
  const body = Array.from({ length: 400 }, (_, index) => `Paragraph ${index} with some words in it.`).join('\n\n')
  const parts = questionCards(400, { ...QUESTION, body }, null)

  expect(parts.length).toBeGreaterThan(1)
  for (const part of parts) {
    expect(part.height).toBeLessThanOrEqual(4096)
  }
})

test('the recommendation names its choice, and turns green once accepted', async () => {
  const [card] = recommendationCards(500, QUESTION.recommendation, false)
  expect(card?.source).toContain('CHOICE A')
  expect(card?.source).toContain('class="card-accent"')

  const [accepted] = recommendationCards(500, QUESTION.recommendation, true)
  expect(accepted?.source).toContain('✓ ACCEPTED')
  expect(accepted?.source).toContain('class="card-success"')
})

test('the preview names the choice a typed letter stands for', async () => {
  const [choice] = previewCard(500, 'b', { letter: 'b', text: 'A day off' })
  expect(choice?.alt).toBe('Saves choice b: A day off')
  expect(choice?.source).toContain('SAVES CHOICE B')

  const [typed] = previewCard(500, 'A longer answer', undefined)
  expect(typed?.source).toContain('15 CHARACTERS')
})

test('a review card says how the question was answered', async () => {
  expect(reviewCard(500, 0, QUESTION, null).source).toContain('class="card-warning"')
  expect(reviewCard(500, 0, QUESTION, { kind: 'recommendation' }).source).toContain('Recommendation accepted')
  expect(reviewCard(500, 0, QUESTION, { kind: 'text', text: 'Mornings only' }).alt).toBe('1 · Day: Mornings only')
})
