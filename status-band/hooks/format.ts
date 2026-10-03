import type { Span, Usage } from '../types'

export const COLORS = {
  green: '#22a355',
  yellow: '#d4a017',
  red: '#e5484d',
}

export function usageColor(percent: number): string {
  if (percent >= 85) {
    return COLORS.red
  }
  if (percent >= 60) {
    return COLORS.yellow
  }

  return COLORS.green
}

export function spansOf(usage: Usage): Span[] {
  const readings: [string, number | null][] = [
    ['C', usage.contextPercent],
    ['5h', usage.fiveHourPercent],
    ['W', usage.sevenDayPercent],
  ]
  const spans: Span[] = []
  for (const [label, percent] of readings) {
    if (percent === null) {
      continue
    }
    if (spans.length > 0) {
      spans.push({ text: ' · ', isDim: true })
    }
    spans.push({ text: `${label} `, isDim: true }, { text: `${Math.round(percent)}%`, color: usageColor(percent) })
  }

  return spans
}
