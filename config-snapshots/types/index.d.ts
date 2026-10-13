export type Snapshot = { createdAt: string; name: string; message: string }

export type Comparison = { name: string; text: string; isFull: boolean }

declare module 'claude-code' {
  interface PluginState {
    'config-snapshots': {
      snapshots: Snapshot[]
      selected: string | null
      output: string
      isArmed: boolean
      isBusy: boolean
      comparison: Comparison | null
      notice: string
      isChanged: boolean | null
    }
  }
}
