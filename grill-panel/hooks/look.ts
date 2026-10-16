import type { Answer, Question } from '../types'
import { choiceAnswerOf, choicesOf, recommendedLetterOf } from './rounds'
import type { Choice } from './rounds'
import { EYEBROW, LINE, PAD, SIZE, blockSections, cards, escape, eyebrowSvg, eyebrowWidth, fitText, frame, parseBlocks, parseInline, plainOf, svgDocument, textSection, textWidth } from './svg'
import type { Card, Section, Variant } from './svg'

export { headerCard, noticeCard } from './svg'
export type { Card, Segment } from './svg'

type ChoiceState = 'plain' | 'recommended' | 'chosen'

function pillSvg(text: string, right: number, y: number, tone: 'pill' | 'pill-success'): { svg: string; width: number } {
  const width = eyebrowWidth(text) - 1 + 16
  const label = tone === 'pill' ? 'eyebrow' : 'success'

  return {
    width,
    svg: `<rect class="${tone}" x="${(right - width).toFixed(1)}" y="${y}" width="${width.toFixed(1)}" height="20" rx="10"/>${eyebrowSvg(text, right - width / 2, y + 14, label, 'middle')}`,
  }
}

function choiceSection(choice: Choice, state: ChoiceState, x: number, width: number): Section {
  const inset = 12
  const badge = 26
  const textX = x + inset + badge + 12
  const pillText = state === 'recommended' ? 'RECOMMENDED' : state === 'chosen' ? 'YOUR ANSWER' : ''
  const pillWidth = pillText.length === 0 ? 0 : eyebrowWidth(pillText) + 16 + 10
  const textWidthMax = x + width - inset - textX
  const text = textSection(parseInline(choice.text), textX, textWidthMax, { firstWidth: textWidthMax - pillWidth })
  const height = Math.max(badge, text.height) + 2 * inset
  const tile = state === 'recommended' ? 'tile-accent' : state === 'chosen' ? 'tile-success' : 'tile'
  const circle = state === 'recommended' ? 'accent' : state === 'chosen' ? 'success' : 'badge'
  const glyph = state === 'chosen' ? '✓' : choice.letter.toUpperCase()

  return {
    height: height + 8,
    draw: y => {
      const top = y + 8
      const centerY = top + inset + badge / 2
      const pill = pillText.length === 0 ? '' : pillSvg(pillText, x + width - inset, top + inset + 3, state === 'chosen' ? 'pill-success' : 'pill').svg
      const textTop = top + inset + (text.height <= LINE ? (badge - LINE) / 2 : 0)

      return [
        `<rect class="${tile}" x="${x + 0.5}" y="${top + 0.5}" width="${width - 1}" height="${height - 1}" rx="11"${state === 'plain' ? '' : ' stroke-width="1.5"'}/>`,
        `<circle class="${circle}" cx="${x + inset + badge / 2}" cy="${centerY}" r="${badge / 2}"/>`,
        `<text class="${state === 'plain' ? 'badge-t' : 'on-accent'}" x="${x + inset + badge / 2}" y="${centerY + 4.5}" font-size="13" font-weight="700" text-anchor="middle">${escape(glyph)}</text>`,
        text.draw(textTop),
        pill,
      ].join('')
    },
  }
}

function chosenLetterOf(options: readonly Choice[], answer: Answer | null): string | null {
  return answer?.kind === 'text' ? (options.find(i => choiceAnswerOf(i) === answer.text)?.letter ?? null) : null
}

// The question's text with its choices drawn as tiles: the recommended one in
// the accent color, the one already picked in green.
export function questionCards(width: number, question: Question, answer: Answer | null): Card[] {
  const inner = width - 2 * PAD
  const choices = choicesOf(question.body)
  const recommended = recommendedLetterOf(question.recommendation)
  const chosen = chosenLetterOf(choices.options, answer) ?? (answer?.kind === 'recommendation' ? recommended : null)
  const sections = [
    ...blockSections(parseBlocks(choices.lead), PAD, inner),
    ...choices.options.map(choice => choiceSection(choice, choice.letter === chosen ? 'chosen' : choice.letter === recommended && chosen === null ? 'recommended' : 'plain', PAD, inner)),
    ...blockSections(parseBlocks(choices.trail), PAD, inner).map((section, index) => (index === 0 ? { height: section.height + 12, draw: (y: number) => section.draw(y + 12) } : section)),
  ]
  if (sections.length === 0) {
    return []
  }

  return cards(width, 'card', sections, plainOf(question.body.replace(/\s+/gu, ' ')))
}

function headSection(left: string, right: string | null, rightTone: string, width: number): Section {
  return {
    height: EYEBROW + 10,
    draw: y => eyebrowSvg(left, PAD, y + EYEBROW) + (right === null ? '' : eyebrowSvg(right, width - PAD, y + EYEBROW, rightTone, 'end')),
  }
}

export function recommendationCards(width: number, recommendation: string, isAccepted: boolean): Card[] {
  const letter = recommendedLetterOf(recommendation)
  const sections = [
    headSection(letter === null ? '★ RECOMMENDATION' : `★ RECOMMENDATION · CHOICE ${letter.toUpperCase()}`, isAccepted ? '✓ ACCEPTED' : null, 'success', width),
    ...blockSections(parseBlocks(recommendation), PAD, width - 2 * PAD),
  ]

  return cards(width, isAccepted ? 'card-success' : 'card-accent', sections, `Recommendation: ${plainOf(recommendation.replace(/\s+/gu, ' '))}`)
}

// What Enter will save, wrapped: the field itself is one line, and a typed
// letter shows the choice it stands for.
export function previewCard(width: number, text: string, choice: Choice | undefined): Card[] {
  const head = headSection(
    choice === undefined ? 'YOUR ANSWER' : `SAVES CHOICE ${choice.letter.toUpperCase()}`,
    choice === undefined ? `${Array.from(text).length} CHARACTERS` : 'ENTER',
    'muted',
    width,
  )
  const body = textSection(choice === undefined ? [{ text }] : parseInline(choice.text), PAD, width - 2 * PAD)

  return cards(width, 'card', [head, body], choice === undefined ? `Your answer: ${text}` : `Saves choice ${choice.letter}: ${plainOf(choice.text)}`)
}

export function reviewCard(width: number, index: number, question: Question, answer: Answer | null): Card {
  const badge = 26
  const x = PAD + badge + 12
  const inner = width - x - PAD
  const title = textSection(parseInline(question.title.length > 0 ? question.title : `Question ${question.number}`).map(i => ({ ...i, isBold: true })), x, inner, { maxLines: 2 })
  const body =
    answer === null
      ? textSection([{ text: 'Unanswered · goes out as (unanswered)' }], x, inner, { tone: 'warning' })
      : answer.kind === 'recommendation'
        ? textSection([{ text: '★ Recommendation accepted' }], x, inner, { tone: 'accent' })
        : textSection(parseInline(answer.text.replace(/\n+/gu, ' ')), x, inner, { maxLines: 8 })
  const detail = answer?.kind === 'recommendation' && question.recommendation !== null ? textSection(parseInline(question.recommendation.replace(/\s+/gu, ' ')), x, inner, { tone: 'muted', maxLines: 3 }) : null
  const height = PAD + title.height + 4 + body.height + (detail === null ? 0 : detail.height + 2) + PAD
  const variant: Variant = answer === null ? 'card-warning' : 'card'
  const circle = answer === null ? 'skipped' : 'success'
  const centerY = PAD + badge / 2

  return {
    height,
    alt: `${index + 1} · ${plainOf(question.title)}: ${answer === null ? 'unanswered' : answer.kind === 'recommendation' ? 'recommendation accepted' : answer.text}`,
    source: svgDocument(
      width,
      height,
      [
        frame(width, height, variant),
        `<circle class="${circle}" cx="${PAD + badge / 2}" cy="${centerY}" r="${badge / 2}"/>`,
        `<text class="on-accent" x="${PAD + badge / 2}" y="${centerY + 4.5}" font-size="13" font-weight="700" text-anchor="middle">${answer === null ? index + 1 : '✓'}</text>`,
        title.draw(PAD + 2),
        body.draw(PAD + 2 + title.height + 4),
        detail === null ? '' : detail.draw(PAD + 2 + title.height + 4 + body.height + 2),
      ].join(''),
    ),
  }
}

export function sendingCard(width: number): Card {
  const height = 64
  const dots = [0, 1, 2].map(i => `<circle class="accent dot dot${i + 1}" cx="${PAD + 6 + i * 14}" cy="${height / 2}" r="4"/>`).join('')
  const label = `<text class="t" x="${PAD + 52}" y="${height / 2 + 5}" font-size="${SIZE}" font-weight="600">Sending</text>`
  const note = `<text class="muted" x="${PAD + 52 + textWidth('Sending', SIZE, true) + 10}" y="${height / 2 + 5}" font-size="13">${escape(fitText('Claude gets the answers as soon as it is free.', width - PAD * 2 - 62 - textWidth('Sending', SIZE, true), 13))}</text>`

  return { height, alt: 'Sending… Claude gets the answers as soon as it is free.', source: svgDocument(width, height, frame(width, height, 'card-accent') + dots + label + note) }
}
