import { PAD, blockSections, cards, eyebrowSection, parseBlocks, plainOf } from './svg'
import type { Card, Variant } from './svg'

export { headerCard } from './svg'
export type { Card } from './svg'

// A prompt, an answer or a task as the other session wrote it, its Markdown
// drawn in the card.
export function messageCards(width: number, eyebrow: string, text: string, variant: Variant): Card[] {
  return cards(width, variant, [eyebrowSection(eyebrow, null, 'muted', width), ...blockSections(parseBlocks(text), PAD, width - 2 * PAD)], `${eyebrow}: ${plainOf(text.replace(/\s+/gu, ' '))}`)
}
