export type GitState = {
  branch: string
  worktree: string | null
  changed: number
  untracked: number
  ahead: number
  behind: number
}

export type RateLimitReading = {
  percent: number
  resetsAt: string | null
}

export type Snapshot = {
  model: string
  permissionMode: string | null
  agent: string | null
  isFastMode: boolean
  isThinkingOff: boolean
  outputStyle: string | null
  directory: string
  home: string
  git: GitState | null
  contextPercent: number | null
  fiveHour: RateLimitReading | null
  costUsd: number | null
  durationMs: number
}

export type Span = {
  text: string
  color?: string
  isDim?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'status-band': {
      snapshot: Snapshot | null
      statuses: Readonly<Record<string, string>>
    }
  }
}
