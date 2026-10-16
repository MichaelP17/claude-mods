import type { Answer, Question } from '../types'
import { choiceAnswerOf, choicesOf, recommendedLetterOf } from './rounds'
import type { Choice } from './rounds'
import { clampLines, escape, fitText, lineSvg, parseBlocks, parseInline, plainOf, svgDocument, textWidth, wrapRuns } from './svg'
import type { Block, Run } from './svg'

export type Segment = 'answered' | 'skipped' | 'current' | 'open'

export type Card = { source: string; height: number; alt: string }

type Variant = 'card' | 'card-accent' | 'card-success' | 'card-warning' | 'card-error'

type Section = { height: number; draw: (y: number) => string }

const PAD = 18
const GAP = 12
const SIZE = 14
const LINE = 21
const EYEBROW = 11
const RADIUS = 14

// The engine refuses an Svg taller than 4096 pixels; a longer card is cut
// between sections into several cards of the same look.
const MAX_HEIGHT = 4000

function baseline(y: number, line: number, lineHeight = LINE): number {
  return y + line * lineHeight + lineHeight * 0.72
}

function frame(width: number, height: number, variant: Variant): string {
  return `<rect class="${variant}" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${RADIUS}"/>`
}

function eyebrowSvg(text: string, x: number, y: number, tone = 'eyebrow', anchor = 'start'): string {
  return `<text class="${tone}" x="${x}" y="${y}" font-size="${EYEBROW}" font-weight="700" letter-spacing="1.1" text-anchor="${anchor}">${escape(text)}</text>`
}

function eyebrowWidth(text: string): number {
  return textWidth(text, EYEBROW, true) + text.length * 1.1
}

function textSection(
  runs: readonly Run[],
  x: number,
  maxWidth: number,
  options: { tone?: string; size?: number; maxLines?: number; weight?: number; firstWidth?: number } = {},
): Section {
  const size = options.size ?? SIZE
  const lineHeight = Math.round(size * 1.5)
  const wrapped = wrapRuns(runs, maxWidth, size, options.firstWidth)
  const lines = options.maxLines === undefined ? wrapped : clampLines(wrapped, options.maxLines, maxWidth, size)

  return {
    height: lines.length * lineHeight,
    draw: y => lines.map((line, index) => lineSvg(line, x, baseline(y, index, lineHeight), size, options.tone, options.weight)).join(''),
  }
}

function codeSection(lines: readonly string[], x: number, maxWidth: number): Section {
  const size = 12.5
  const lineHeight = 18
  const perLine = Math.max(8, Math.floor((maxWidth - 24) / (size * 0.62)))
  const rows = lines.flatMap(line => {
    const chars = Array.from(line)
    const pieces: string[] = []
    for (let index = 0; index < Math.max(1, chars.length); index += perLine) {
      pieces.push(chars.slice(index, index + perLine).join(''))
    }

    return pieces
  })

  return {
    height: rows.length * lineHeight + 20,
    draw: y =>
      `<rect class="codebg" x="${x}" y="${y}" width="${maxWidth}" height="${rows.length * lineHeight + 20}" rx="8"/>` +
      rows.map((row, index) => lineSvg([{ text: row, isCode: true }], x + 12, baseline(y + 10, index, lineHeight), size / 0.92)).join(''),
  }
}

function blockSection(block: Block, x: number, maxWidth: number): Section {
  switch (block.kind) {
    case 'code':
      return codeSection(block.lines, x, maxWidth)
    case 'heading':
      return textSection(block.runs, x, maxWidth, { size: SIZE + 1.5, weight: 650 })
    case 'quote': {
      const text = textSection(block.runs, x + 14, maxWidth - 14, { tone: 'muted' })

      return { height: text.height, draw: y => `<rect class="rule" x="${x}" y="${y + 2}" width="3" height="${text.height - 4}" rx="1.5"/>${text.draw(y)}` }
    }
    case 'item': {
      const indent = block.marker === '•' ? 16 : textWidth(block.marker, SIZE) + 8
      const text = textSection(block.runs, x + indent, maxWidth - indent)

      return {
        height: text.height,
        draw: y => `<text class="muted" x="${x + (block.marker === '•' ? 3 : 0)}" y="${baseline(y, 0).toFixed(1)}" font-size="${SIZE}">${escape(block.marker)}</text>${text.draw(y)}`,
      }
    }
    default:
      return textSection(block.runs, x, maxWidth)
  }
}

// Paragraphs sit further apart than the items of one list.
function blockSections(blocks: readonly Block[], x: number, maxWidth: number): Section[] {
  return blocks.map((block, index) => {
    const section = blockSection(block, x, maxWidth)
    const previous = blocks[index - 1]
    const spacing = index === 0 ? 0 : previous?.kind === 'item' && block.kind === 'item' ? 4 : 10

    return { height: section.height + spacing, draw: y => section.draw(y + spacing) }
  })
}

// Stacks sections inside one frame; past MAX_HEIGHT the rest go on in a next one.
function cards(width: number, variant: Variant, sections: readonly Section[], alt: string, decoration = ''): Card[] {
  const result: Card[] = []
  let pending: Section[] = []
  let used = 2 * PAD
  const close = () => {
    if (pending.length === 0) {
      return
    }
    let y = PAD
    const body = pending.map(section => {
      const drawn = section.draw(y)
      y += section.height

      return drawn
    })
    const height = Math.ceil(y + PAD)
    result.push({ height, alt, source: svgDocument(width, height, frame(width, height, variant) + (result.length === 0 ? decoration : '') + body.join('')) })
    pending = []
    used = 2 * PAD
  }
  for (const section of sections) {
    if (pending.length > 0 && used + section.height > MAX_HEIGHT) {
      close()
    }
    pending.push(section)
    used += section.height
  }
  close()

  return result
}

const GLOW =
  '<defs><linearGradient id="glow" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d97757" stop-opacity="0.14"/><stop offset="0.55" stop-color="#d97757" stop-opacity="0"/></linearGradient></defs>'

export function headerCard(card: { width: number; eyebrow: string; title: string; counter: string; segments: readonly Segment[] }): Card {
  const { width, segments } = card
  const inner = width - 2 * PAD
  const counterWidth = textWidth(card.counter, 12)
  const eyebrow = fitText(card.eyebrow, inner - counterWidth - 16, EYEBROW, true)
  const title = textSection(parseInline(card.title).map(i => ({ ...i, isBold: true })), PAD, inner, { size: 17, maxLines: 2 })
  const titleTop = PAD + EYEBROW + 8
  const barY = titleTop + title.height + 12
  const height = barY + 6 + PAD
  const count = Math.max(1, segments.length)
  const segmentWidth = (inner - 4 * (count - 1)) / count
  const bars = segments.map(
    (segment, index) => `<rect class="${segment}" x="${(PAD + index * (segmentWidth + 4)).toFixed(1)}" y="${barY}" width="${segmentWidth.toFixed(1)}" height="6" rx="3"/>`,
  )
  const body = [
    frame(width, height, 'card'),
    GLOW,
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${RADIUS}" fill="url(#glow)"/>`,
    eyebrowSvg(eyebrow, PAD, PAD + EYEBROW),
    `<text class="muted" x="${width - PAD}" y="${PAD + EYEBROW}" font-size="12" text-anchor="end">${escape(card.counter)}</text>`,
    title.draw(titleTop),
    ...bars,
  ]

  return { height, alt: `${card.eyebrow}: ${plainOf(card.title)}, ${card.counter}`, source: svgDocument(width, height, body.join('')) }
}

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

export function noticeCard(width: number, variant: 'card-warning' | 'card-error', title: string, text: string): Card[] {
  const inner = width - 2 * PAD
  const body = textSection([{ text }], PAD, inner, { tone: 'muted' })
  const sections = [textSection([{ text: title, isBold: true }], PAD, inner, { size: 15 }), { height: body.height + 6, draw: (y: number) => body.draw(y + 6) }]

  return cards(width, variant, sections, `${title} ${text}`)
}

export function sendingCard(width: number): Card {
  const height = 64
  const dots = [0, 1, 2].map(i => `<circle class="accent dot dot${i + 1}" cx="${PAD + 6 + i * 14}" cy="${height / 2}" r="4"/>`).join('')
  const label = `<text class="t" x="${PAD + 52}" y="${height / 2 + 5}" font-size="${SIZE}" font-weight="600">Sending</text>`
  const note = `<text class="muted" x="${PAD + 52 + textWidth('Sending', SIZE, true) + 10}" y="${height / 2 + 5}" font-size="13">${escape(fitText('Claude gets the answers as soon as it is free.', width - PAD * 2 - 62 - textWidth('Sending', SIZE, true), 13))}</text>`

  return { height, alt: 'Sending… Claude gets the answers as soon as it is free.', source: svgDocument(width, height, frame(width, height, 'card-accent') + dots + label + note) }
}
