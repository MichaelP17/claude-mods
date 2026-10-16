import { LINE, PAD, blockSections, cards, parseBlocks, plainOf } from './svg'
import type { Card } from './svg'

export { buttonWidthOf, headerCard } from './svg'
export type { Card } from './svg'

const BADGE = 22

// One idea, numbered, its Markdown drawn as written; `reserve` keeps the text
// clear of the native buttons laid over the card's right edge.
export function ideaCards(width: number, idea: string, index: number, reserve: number): Card[] {
  const textX = PAD + BADGE + 14
  const center = PAD + LINE / 2
  const badge = [
    `<circle class="badge" cx="${PAD + BADGE / 2}" cy="${center}" r="${BADGE / 2}"/>`,
    `<text class="badge-t" x="${PAD + BADGE / 2}" y="${center + 4.5}" font-size="12" font-weight="700" text-anchor="middle">${index + 1}</text>`,
  ].join('')

  return cards(width, 'card', blockSections(parseBlocks(idea), textX, width - textX - PAD - reserve), `${index + 1}. ${plainOf(idea.replace(/\s+/gu, ' '))}`, badge)
}
