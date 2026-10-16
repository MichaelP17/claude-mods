import { expect, test } from 'claude-code/testing'

import {
  answerCurrent,
  answerOf,
  choiceAnswerOf,
  choicesOf,
  editAt,
  formatAnswers,
  goBack,
  lastRoundIn,
  latestRoundIn,
  newRound,
  parseQuestions,
  previewOf,
  recommendedLetterOf,
  roundKeyOf,
  skipCurrent,
} from './rounds'

const ROUND = `Here is the next round.

---

❓ **Q1** - **Where do answers go?**: Two options:
- a panel
- the prompt box

Pick one.

➡️ The panel, because nothing reaches Claude before sending.

---

❓ **Q2 (updated)** - **Name**: What is it called?

➡️ grill-panel

❓ **Q3** - **Push**: Push right away?

Once that is settled, I start.`

test('a round in the grilling format is read question by question', async () => {
  const questions = parseQuestions(ROUND)
  expect(questions).toEqual([
    {
      number: 1,
      title: 'Where do answers go?',
      body: 'Two options:\n- a panel\n- the prompt box\n\nPick one.',
      recommendation: 'The panel, because nothing reaches Claude before sending.',
    },
    { number: 2, title: 'Name', body: 'What is it called?', recommendation: 'grill-panel' },
    { number: 3, title: 'Push', body: 'Push right away?\n\nOnce that is settled, I start.', recommendation: null },
  ])
})

test('the variants a model drifts into are read too', async () => {
  const text = [
    '**Q4 – Inline title** body on the header line',
    '➡️ yes',
    '',
    '❓ Q5 - Plain title: plain body',
    '➡️ no',
    '',
    '❓ **Q6**: no title at all',
    '➡️ maybe',
    '  still the recommendation',
  ].join('\n')
  expect(parseQuestions(text)).toEqual([
    { number: 4, title: 'Inline title', body: 'body on the header line', recommendation: 'yes' },
    { number: 5, title: 'Plain title', body: 'plain body', recommendation: 'no' },
    { number: 6, title: '', body: 'no title at all', recommendation: 'maybe\n  still the recommendation' },
  ])
})

test('prose and code that merely mention Q1 are no round', async () => {
  expect(parseQuestions('Revenue in **Q3** rose, **Q4** will tell.')).toEqual([])
  expect(parseQuestions('The skill asks like this:\n\n```\n❓ **Q1** - **<title>**: <body>\n\n➡️ <recommendation>\n```\n')).toEqual([])
  expect(parseQuestions('')).toEqual([])
})

test('answers move on to the next open question and end in the review', async () => {
  const questions = parseQuestions(ROUND)
  let round = newRound('k', questions, [])
  expect(round.current).toBe(0)

  round = answerCurrent(round, '  the panel\nfor sure  ')
  expect(round.answers[0]).toEqual({ kind: 'text', text: 'the panel\nfor sure' })
  expect(round.current).toBe(1)

  round = skipCurrent(round)
  expect(round.current).toBe(2)
  expect(round.skipped).toEqual([false, true, false])

  const unchanged = answerCurrent(round, '   ')
  expect(unchanged).toBe(round)

  round = answerCurrent(round, 'not yet')
  expect(round.current).toBe(1)
  expect(round.mode).toBe('answer')

  round = answerCurrent(round, '')
  expect(round.answers[1]).toEqual({ kind: 'recommendation' })
  expect(round.skipped).toEqual([false, false, false])
  expect(round.mode).toBe('review')

  round = answerCurrent(editAt(round, 0), 'the prompt box')
  expect(round.answers[0]).toEqual({ kind: 'text', text: 'the prompt box' })
  expect(round.mode).toBe('review')
})

test('back stops at the first question, and a lone skip ends in the review', async () => {
  const round = newRound('k', parseQuestions(ROUND), [])
  expect(goBack(round)).toBe(round)
  expect(goBack(answerCurrent(round, 'x')).current).toBe(0)

  const last = newRound('k', parseQuestions(ROUND), [{ kind: 'recommendation' }, null, { kind: 'text', text: 'no' }])
  expect(last.current).toBe(1)
  expect(skipCurrent(last).mode).toBe('review')
})

test('a round restored with every answer opens in the review', async () => {
  const round = newRound('k', parseQuestions(ROUND), [{ kind: 'recommendation' }, { kind: 'recommendation' }, { kind: 'text', text: 'no' }])
  expect(round.mode).toBe('review')
})

test('the answers go out as Q lines, open ones marked', async () => {
  const round = newRound('k', parseQuestions(ROUND), [{ kind: 'text', text: 'panel\nfor sure' }, { kind: 'recommendation' }, null])
  expect(formatAnswers(round)).toBe('Q1: panel\nfor sure\n\nQ2: Recommendation accepted\n\nQ3: (unanswered)')
})

test('the key tells rounds and projects apart and stays the same for the same round', async () => {
  const questions = parseQuestions(ROUND)
  expect(roundKeyOf('/a', questions)).toBe(roundKeyOf('/a', parseQuestions(ROUND)))
  expect(roundKeyOf('/a', questions)).not.toBe(roundKeyOf('/b', questions))
  expect(roundKeyOf('/a', questions)).not.toBe(roundKeyOf('/a', questions.slice(1)))
})

test('a resume offers only the round Claude ended on; /grill finds the latest one', async () => {
  const messages = [
    { role: 'assistant', text: ROUND },
    { role: 'user', text: 'What do you mean by panel?' },
    { role: 'assistant', text: 'A side pane next to the transcript.' },
    { role: 'assistant', text: '' },
  ] as const
  expect(lastRoundIn(messages)).toEqual([])
  expect(latestRoundIn(messages).length).toBe(3)
  expect(lastRoundIn(messages.slice(0, 1)).length).toBe(3)
})

test('the review shows the first line of an answer', async () => {
  expect(previewOf(null)).toBe('unanswered')
  expect(previewOf({ kind: 'recommendation' })).toBe('recommendation accepted')
  expect(previewOf({ kind: 'text', text: 'short' })).toBe('short')
  expect(previewOf({ kind: 'text', text: 'first\nsecond' })).toBe('first …')
  expect(previewOf({ kind: 'text', text: 'abcdefghij' }, 5)).toBe('abcd…')
})

test('choices written inline or one per line are split off the question', async () => {
  expect(choicesOf('What is tomorrow? (a) A work day, evenings for projects (b) A day off (c) Mixed, e.g. half and half')).toEqual({
    lead: 'What is tomorrow?',
    options: [
      { letter: 'a', text: 'A work day, evenings for projects' },
      { letter: 'b', text: 'A day off' },
      { letter: 'c', text: 'Mixed, e.g. half and half' },
    ],
    trail: '',
  })
  expect(choicesOf('Pick one:\n- (a) Panel\n- (b) Prompt box')).toEqual({
    lead: 'Pick one:',
    options: [
      { letter: 'a', text: 'Panel' },
      { letter: 'b', text: 'Prompt box' },
    ],
    trail: '',
  })
  expect(choicesOf('Who uses it?\n(a) only you,\n(b) a team,\n  with roles\n(c) everyone.\nThat decides the login.')).toEqual({
    lead: 'Who uses it?',
    options: [
      { letter: 'a', text: 'only you' },
      { letter: 'b', text: 'a team, with roles' },
      { letter: 'c', text: 'everyone.' },
    ],
    trail: 'That decides the login.',
  })
  expect(choicesOf('Only (a) one choice')).toEqual({ lead: 'Only (a) one choice', options: [], trail: '' })
  expect(choicesOf('See (b) first, then (a) Panel (b) Prompt').options.map(i => i.letter)).toEqual(['a', 'b'])
  expect(choiceAnswerOf({ letter: 'b', text: 'A day off' })).toBe('(b) A day off')
})

test('a lone letter stands for the choice it names', async () => {
  const question = { number: 1, title: 'Day', body: 'What is tomorrow? (a) A work day (b) A day off', recommendation: null }
  expect(answerOf('b', question)).toEqual({ kind: 'text', text: '(b) A day off' })
  expect(answerOf(' (A) ', question)).toEqual({ kind: 'text', text: '(a) A work day' })
  expect(answerOf('c', question)).toEqual({ kind: 'text', text: 'c' })
  expect(answerOf('b', { ...question, body: 'Anything?' })).toEqual({ kind: 'text', text: 'b' })
  expect(answerOf('b, but only mornings', question)).toEqual({ kind: 'text', text: 'b, but only mornings' })
})

test('a recommendation that opens with a choice names it', async () => {
  expect(recommendedLetterOf('(a), since it is midweek.')).toBe('a')
  expect(recommendedLetterOf('**(c)** mixed')).toBe('c')
  expect(recommendedLetterOf('The panel (a)')).toBeNull()
  expect(recommendedLetterOf(null)).toBeNull()
})
