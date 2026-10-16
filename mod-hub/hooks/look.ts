import type { HubEntry } from '../types'
import { PAD, escape, fitText, frame, svgDocument } from './svg'
import type { Card } from './svg'

export { buttonWidthOf, headerCard } from './svg'
export type { Card } from './svg'

const HEIGHT = 64

const TONE_OF = {
  none: { dot: 'muted', alt: 'quiet' },
  info: { dot: 'accent', alt: 'active' },
  warning: { dot: 'warning', alt: 'needs attention' },
} as const

// One mod: its icon on a tile, its title and its status; `reserve` keeps the
// text clear of the native action buttons laid over the card's right edge.
export function entryCard(width: number, entry: HubEntry, reserve: number): Card {
  const tone = TONE_OF[entry.attention]
  const textX = PAD + 46
  const maxWidth = width - textX - PAD - reserve
  const middle = HEIGHT / 2
  const statusX = textX + 12
  const body = [
    frame(width, HEIGHT, entry.attention === 'warning' ? 'card-warning' : 'card'),
    `<rect class="badge" x="${PAD}" y="${middle - 17}" width="34" height="34" rx="9"/>`,
    `<text x="${PAD + 17}" y="${middle + 6}" font-size="17" text-anchor="middle">${escape(entry.icon)}</text>`,
    `<text class="t" x="${textX}" y="${middle - 4}" font-size="14" font-weight="650">${escape(fitText(entry.title, maxWidth, 14, true))}</text>`,
    entry.attention === 'none' ? '' : `<circle class="${tone.dot} ripple" cx="${textX + 4}" cy="${middle + 11}" r="3.5"/>`,
    `<circle class="${tone.dot}" cx="${textX + 4}" cy="${middle + 11}" r="3.5"/>`,
    `<text class="${entry.attention === 'none' ? 'muted' : tone.dot}" x="${statusX}" y="${middle + 15}" font-size="12.5">${escape(fitText(entry.status, maxWidth - 12, 12.5))}</text>`,
  ]

  return { height: HEIGHT, alt: `${entry.title}: ${entry.status} (${tone.alt})`, source: svgDocument(width, HEIGHT, body.join('')) }
}
