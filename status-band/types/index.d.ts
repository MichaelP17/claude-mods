export type Usage = {
  contextPercent: number | null
  fiveHourPercent: number | null
  sevenDayPercent: number | null
}

export type Span = {
  text: string
  color?: string
  isDim?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'status-band': {
      usage: Usage | null
    }
  }
}
