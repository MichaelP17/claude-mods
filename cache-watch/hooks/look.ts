import { PAD, escape, fitText, frame, svgDocument } from './svg'
import type { Card } from './svg'

export { buttonWidthOf } from './svg'
export type { Card } from './svg'

const HEIGHT = 68
const RING = 40

// The band is drawn once per suggestion, not on every second, so the bar at
// its foot runs out by itself: a CSS animation as long as the cache has left.
export function cacheBandCard(
  width: number,
  band: { isExpiring: boolean; title: string; hint: string; ring: string; remainingMs: number; ttlMs: number; reserve: number },
): Card {
  const tone = band.isExpiring ? 'warning' : 'accent'
  const fraction = band.ttlMs === 0 ? 0 : Math.max(0, Math.min(1, band.remainingMs / band.ttlMs))
  const radius = (RING - 4) / 2
  const center = { x: PAD + RING / 2, y: HEIGHT / 2 - 3 }
  const circumference = 2 * Math.PI * radius
  const textX = PAD + RING + 14
  const maxWidth = width - textX - PAD - band.reserve
  const barWidth = width - 2 * PAD
  const seconds = Math.max(1, Math.round(band.remainingMs / 1000))
  const drain =
    fraction === 0
      ? ''
      : `<style>.drain{transform-box:fill-box;transform-origin:left;animation:drain ${seconds}s linear forwards}@keyframes drain{from{transform:scaleX(1)}to{transform:scaleX(0)}}@media (prefers-reduced-motion: reduce){.drain{animation:none}}</style><rect class="${tone} drain" x="${PAD}" y="${HEIGHT - 9}" width="${(barWidth * fraction).toFixed(1)}" height="3" rx="1.5"/>`
  const body = [
    frame(width, HEIGHT, band.isExpiring ? 'card-warning' : 'card-accent'),
    `<circle cx="${center.x}" cy="${center.y}" r="${radius}" fill="none" stroke="#8b8b8b" stroke-opacity="0.25" stroke-width="4"/>`,
    fraction === 0
      ? ''
      : `<circle cx="${center.x}" cy="${center.y}" r="${radius}" fill="none" stroke="${band.isExpiring ? '#d4a017' : '#d97757'}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(circumference * fraction).toFixed(2)} ${circumference.toFixed(2)}" transform="rotate(-90 ${center.x} ${center.y})"/>`,
    `<text class="${tone}" x="${center.x}" y="${center.y + 4}" font-size="11.5" font-weight="700" text-anchor="middle">${escape(band.ring)}</text>`,
    `<text class="t" x="${textX}" y="${center.y - 3}" font-size="14" font-weight="650">${escape(fitText(band.title, maxWidth, 14, true))}</text>`,
    `<text class="muted" x="${textX}" y="${center.y + 15}" font-size="12.5">${escape(fitText(band.hint, maxWidth, 12.5))}</text>`,
    `<rect class="open" x="${PAD}" y="${HEIGHT - 9}" width="${barWidth}" height="3" rx="1.5"/>`,
    drain,
  ]

  return { height: HEIGHT, alt: `${band.title}: ${band.hint}`, source: svgDocument(width, HEIGHT, body.join('')) }
}
