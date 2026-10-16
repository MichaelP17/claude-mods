import { PAD, blockSections, cards, escape, eyebrowSection, fitText, frame, parseBlocks, plainOf, svgDocument } from './svg'
import type { Card, Variant } from './svg'

export { barCard, buttonWidthOf, headerCard } from './svg'
export type { Card } from './svg'

// A prompt, an answer or a task as the other session wrote it, its Markdown
// drawn in the card; without an eyebrow when a bar above already names it.
export function messageCards(width: number, eyebrow: string | null, text: string, variant: Variant): Card[] {
  const body = blockSections(parseBlocks(text), PAD, width - 2 * PAD)
  const sections = eyebrow === null ? body : [eyebrowSection(eyebrow, null, 'muted', width), ...body]

  return cards(width, variant, sections, `${eyebrow === null ? 'Message' : eyebrow}: ${plainOf(text.replace(/\s+/gu, ' '))}`)
}

const BAND_HEIGHT = 60

// What waits in the band above the prompt; `reserve` keeps the text clear of
// the native buttons laid over the card's right edge.
export function bandCard(width: number, title: string, detail: string, reserve: number): Card {
  const maxWidth = width - 2 * PAD - reserve
  const middle = BAND_HEIGHT / 2
  const body = [
    frame(width, BAND_HEIGHT, 'card-accent'),
    `<text class="t" x="${PAD}" y="${middle - 3}" font-size="14" font-weight="650">${escape(fitText(title, maxWidth, 14, true))}</text>`,
    `<text class="muted" x="${PAD}" y="${middle + 15}" font-size="12.5">${escape(fitText(detail, maxWidth, 12.5))}</text>`,
  ]

  return { height: BAND_HEIGHT, alt: `${title}: ${detail}`, source: svgDocument(width, BAND_HEIGHT, body.join('')) }
}
