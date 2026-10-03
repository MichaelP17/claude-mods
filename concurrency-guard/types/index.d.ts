export type TrackedMonitor = { taskId: string; description: string; deadline: number | null }

export type LimitOverrides = { subagents: number | null; monitors: number | null }

declare module 'claude-code' {
  interface PluginState {
    'concurrency-guard': {
      monitors: TrackedMonitor[]
      overrides: LimitOverrides
    }
  }
}
