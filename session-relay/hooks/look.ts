// SVG drawn as an image knows neither the theme nor the text color, so the
// strokes use mid tones that read on a light and a dark pane alike.
export const TONES = {
  success: '#2E9E5B',
  warning: '#D4A017',
  neutral: '#8B8B8B',
}

export function dotSvg(color: string, isPulsing: boolean): string {
  const pulse = isPulsing
    ? `<circle cx="7" cy="7" r="3.5" fill="${color}" opacity="0.35"><animate attributeName="r" values="3.5;6.5;3.5" dur="2.4s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.35;0;0.35" dur="2.4s" repeatCount="indefinite"/></circle>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">${pulse}<circle cx="7" cy="7" r="3.5" fill="${color}"/></svg>`
}
