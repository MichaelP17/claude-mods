// SVG drawn as an image knows neither the theme nor the text color, so the
// strokes use mid tones that read on a light and a dark pane alike.
export const TONES = {
  accent: '#D97757',
  success: '#2E9E5B',
  warning: '#D4A017',
  neutral: '#8B8B8B',
}

export function ringSvg(done: number, total: number, size = 44): string {
  const stroke = 4
  const radius = (size - stroke) / 2
  const center = size / 2
  const circumference = 2 * Math.PI * radius
  const fraction = total === 0 ? 0 : Math.min(1, done / total)
  const color = fraction === 1 ? TONES.success : TONES.accent
  const arc =
    fraction === 0
      ? ''
      : `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${(circumference * fraction).toFixed(2)} ${circumference.toFixed(2)}" transform="rotate(-90 ${center} ${center})"/>`

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="${TONES.neutral}" stroke-opacity="0.25" stroke-width="${stroke}"/>`,
    arc,
    `<text x="${center}" y="${center}" text-anchor="middle" dominant-baseline="central" font-family="-apple-system, system-ui, sans-serif" font-size="${size * 0.3}" font-weight="600" fill="${color}">${done}/${total}</text>`,
    '</svg>',
  ].join('')
}
