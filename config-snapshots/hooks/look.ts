// SVG drawn as an image knows neither the theme nor the text color, so the
// strokes use mid tones that read on a light and a dark pane alike.
export const TONES = {
  accent: '#D97757',
  neutral: '#8B8B8B',
}

export function dotSvg(color: string, isPulsing: boolean): string {
  const pulse = isPulsing
    ? `<circle cx="7" cy="7" r="3.5" fill="${color}" opacity="0.35"><animate attributeName="r" values="3.5;6.5;3.5" dur="2.4s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.35;0;0.35" dur="2.4s" repeatCount="indefinite"/></circle>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">${pulse}<circle cx="7" cy="7" r="3.5" fill="${color}"/></svg>`
}

export function spinnerSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="none" stroke="${TONES.neutral}" stroke-opacity="0.25" stroke-width="2"/><path d="M7 2 a5 5 0 0 1 5 5" fill="none" stroke="${TONES.neutral}" stroke-width="2" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 7 7" to="360 7 7" dur="0.9s" repeatCount="indefinite"/></path></svg>`
}
