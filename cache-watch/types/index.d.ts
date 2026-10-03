export type CacheReading = {
  lastRequestAt: number | null
  ttlMs: number
  contextTokens: number
  isRebuildPending: boolean
}

export type Suggestion = { kind: 'expiring' | 'milestone'; contextTokens: number } | null

declare module 'claude-code' {
  interface PluginState {
    'cache-watch': {
      reading: CacheReading
      suggestion: Suggestion
      warnedFor: number | null
      isWorking: boolean
    }
  }
}
