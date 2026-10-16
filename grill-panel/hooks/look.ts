export type Segment = 'answered' | 'skipped' | 'current' | 'open'

export type HeaderCard = { source: string; height: number }

const PAD = 18
const EYEBROW_SIZE = 11
const COUNTER_SIZE = 12
const TITLE_SIZE = 17
const TITLE_LINE = 23
const BAR_HEIGHT = 6
const BAR_GAP = 4

// Drawn as an image the SVG follows the app's light or dark look on its own,
// which a color handed in from the hook could not.
const STYLE = `<style>
text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.card{fill:#f6f5f2;stroke:#e6e4df}.title{fill:#1f1e1d}.muted{fill:#77756f}.eyebrow{fill:#c9643f}
.open{fill:#e4e2dc}.answered{fill:#2e9e5b}.skipped{fill:#d4a017}.current{fill:#d97757}
.current{animation:pulse 1.8s ease-in-out infinite}@keyframes pulse{50%{opacity:.55}}
@media (prefers-color-scheme: dark){.card{fill:#262625;stroke:#353531}.title{fill:#ececea}.muted{fill:#a8a8a4}.eyebrow{fill:#e08a6a}.open{fill:#3a3a37}}
@media (prefers-reduced-motion: reduce){.current{animation:none}}
</style>`

// An image cannot measure its text, so widths are estimated from the font size,
// on the wide side: a line then ends early rather than past the card's edge.
export function textWidth(text: string, size: number, isBold = false): number {
  let units = 0
  for (const char of text) {
    if (/[\s.,:;'|!ijlI]/u.test(char)) {
      units += 0.3
    } else if (/[A-Z@%&MWmw]/u.test(char)) {
      units += 0.74
    } else if (/\p{Extended_Pictographic}/u.test(char)) {
      units += 1.15
    } else {
      units += 0.55
    }
  }

  return units * size * (isBold ? 1.04 : 1)
}

export function fitText(text: string, maxWidth: number, size: number, isBold = false): string {
  if (textWidth(text, size, isBold) <= maxWidth) {
    return text
  }
  const chars = Array.from(text)
  while (chars.length > 0 && textWidth(`${chars.join('')}…`, size, isBold) > maxWidth) {
    chars.pop()
  }

  return `${chars.join('').trimEnd()}…`
}

export function wrapText(text: string, maxWidth: number, size: number, maxLines: number, isBold = false): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/u).filter(i => i.length > 0)) {
    const candidate = line.length === 0 ? word : `${line} ${word}`
    if (line.length === 0 || textWidth(candidate, size, isBold) <= maxWidth) {
      line = candidate
    } else {
      lines.push(line)
      line = word
    }
  }
  if (line.length > 0) {
    lines.push(line)
  }
  const kept = lines.slice(0, maxLines)
  if (lines.length > maxLines) {
    kept[maxLines - 1] = `${kept[maxLines - 1] ?? ''} ${lines.slice(maxLines).join(' ')}`
  }

  return kept.map(i => fitText(i, maxWidth, size, isBold))
}

function escape(text: string): string {
  return text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;')
}

export function headerSvg(card: { width: number; eyebrow: string; title: string; counter: string; segments: readonly Segment[] }): HeaderCard {
  const { width, segments } = card
  const inner = width - 2 * PAD
  const counterWidth = textWidth(card.counter, COUNTER_SIZE)
  const eyebrow = fitText(card.eyebrow, inner - counterWidth - 12, EYEBROW_SIZE, true)
  const titleLines = wrapText(card.title, inner, TITLE_SIZE, 2, true)
  const eyebrowY = PAD + EYEBROW_SIZE
  const titleTop = eyebrowY + 8
  const barY = titleTop + titleLines.length * TITLE_LINE + 12
  const height = barY + BAR_HEIGHT + PAD
  const count = Math.max(1, segments.length)
  const segmentWidth = (inner - BAR_GAP * (count - 1)) / count
  const bars = segments.map(
    (segment, index) =>
      `<rect class="${segment}" x="${(PAD + index * (segmentWidth + BAR_GAP)).toFixed(1)}" y="${barY}" width="${segmentWidth.toFixed(1)}" height="${BAR_HEIGHT}" rx="${BAR_HEIGHT / 2}"/>`,
  )
  const titles = titleLines.map(
    (line, index) =>
      `<text class="title" x="${PAD}" y="${titleTop + (index + 1) * TITLE_LINE - 6}" font-size="${TITLE_SIZE}" font-weight="600">${escape(line)}</text>`,
  )

  return {
    height,
    source: [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      STYLE,
      '<defs><linearGradient id="glow" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d97757" stop-opacity="0.14"/><stop offset="0.55" stop-color="#d97757" stop-opacity="0"/></linearGradient></defs>',
      `<rect class="card" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="14"/>`,
      `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="14" fill="url(#glow)"/>`,
      `<text class="eyebrow" x="${PAD}" y="${eyebrowY}" font-size="${EYEBROW_SIZE}" font-weight="700" letter-spacing="1.2">${escape(eyebrow)}</text>`,
      `<text class="muted" x="${width - PAD}" y="${eyebrowY}" font-size="${COUNTER_SIZE}" text-anchor="end">${escape(card.counter)}</text>`,
      ...titles,
      ...bars,
      '</svg>',
    ].join(''),
  }
}
