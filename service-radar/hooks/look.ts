import type { Service } from '../types'
import { PAD, escape, fitText, frame, svgDocument } from './svg'
import type { Card } from './svg'

export { buttonWidthOf, headerCard } from './svg'
export type { Card } from './svg'

const HEIGHT = 66

export function shortPath(path: string, home: string | undefined): string {
  return home !== undefined && path.startsWith(home) ? `~${path.slice(home.length)}` : path
}

export function clockTime(timestamp: number): string {
  const date = new Date(timestamp)

  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function durationOf(milliseconds: number): string {
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000))
  if (minutes < 1) {
    return 'just started'
  }
  if (minutes < 60) {
    return `${minutes} min`
  }
  const hours = Math.floor(minutes / 60)

  return hours < 24 ? `${hours} h ${minutes % 60} min` : `${Math.floor(hours / 24)} d ${hours % 24} h`
}

// `reserve` keeps the text clear of the native buttons laid over the card's
// right edge, which the picture cannot know of.
export function serviceCard(width: number, service: Service, context: { home: string | undefined; now: number; reserve: number }): Card {
  const isKnown = service.check !== null
  const textX = PAD + 30
  const maxWidth = width - textX - PAD - context.reserve
  const meta = [
    shortPath(service.cwd, context.home),
    `since ${clockTime(service.startedAt)}`,
    isKnown ? durationOf(context.now - service.startedAt) : 'not checkable',
  ].join(' · ')
  const dotX = PAD + 8
  const dotY = HEIGHT / 2
  const tone = isKnown ? 'success' : 'warning'
  const body = [
    frame(width, HEIGHT, 'card'),
    isKnown ? `<circle class="${tone} ripple" cx="${dotX}" cy="${dotY}" r="5"/>` : '',
    `<circle class="${tone}" cx="${dotX}" cy="${dotY}" r="5"/>`,
    `<text class="t" x="${textX}" y="${dotY - 4}" font-size="14" font-weight="650">${escape(fitText(service.label, maxWidth, 14, true))}</text>`,
    `<text class="muted" x="${textX}" y="${dotY + 15}" font-size="12.5">${escape(fitText(meta, maxWidth, 12.5))}</text>`,
  ]

  return {
    height: HEIGHT,
    alt: `${service.label}: ${isKnown ? 'running' : 'state unknown'}, ${meta}`,
    source: svgDocument(width, HEIGHT, body.join('')),
  }
}
