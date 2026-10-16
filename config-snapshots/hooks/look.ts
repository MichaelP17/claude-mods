import type { Snapshot } from '../types'
import { PAD, escape, fitText, frame, svgDocument } from './svg'
import type { Card } from './svg'

export { buttonWidthOf, diffCards, headerCard, noticeCard } from './svg'
export type { Card } from './svg'

const HEIGHT = 64

// One snapshot: what it captures and when; the selected one in the accent
// color, red once a roll back to it is asked for. `reserve` keeps the text
// clear of the native buttons laid over the card's right edge.
export function snapshotCard(width: number, snapshot: Snapshot, state: { isSelected: boolean; isArmed: boolean; reserve: number }): Card {
  const textX = PAD + 26
  const maxWidth = width - textX - PAD - state.reserve
  const middle = HEIGHT / 2
  const title = snapshot.message.length > 0 ? snapshot.message : snapshot.name
  const meta = `${snapshot.createdAt} · ${snapshot.name}`
  const variant = state.isSelected ? (state.isArmed ? 'card-error' : 'card-accent') : 'card'
  const dot = state.isSelected ? (state.isArmed ? 'error' : 'accent') : 'muted'
  const body = [
    frame(width, HEIGHT, variant),
    `<circle class="${dot}" cx="${PAD + 6}" cy="${middle}" r="${state.isSelected ? 6 : 4.5}"/>`,
    state.isSelected ? `<circle class="on-accent" cx="${PAD + 6}" cy="${middle}" r="2.2"/>` : '',
    `<text class="t" x="${textX}" y="${middle - 4}" font-size="14" font-weight="650">${escape(fitText(title, maxWidth, 14, true))}</text>`,
    `<text class="muted" x="${textX}" y="${middle + 15}" font-size="12.5">${escape(fitText(meta, maxWidth, 12.5))}</text>`,
  ]

  return { height: HEIGHT, alt: `${title}: ${meta}${state.isSelected ? ' (selected)' : ''}`, source: svgDocument(width, HEIGHT, body.join('')) }
}

export function spinnerSvg(): string {
  return svgDocument(16, 16, '<circle cx="8" cy="8" r="6" fill="none" stroke="#8b8b8b" stroke-opacity="0.3" stroke-width="2"/><circle cx="8" cy="8" r="6" fill="none" stroke="#d97757" stroke-width="2" stroke-dasharray="9 40" stroke-linecap="round" class="spin"/>')
}
