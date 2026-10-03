export type Snapshot = { createdAt: string; name: string; message: string }

declare module 'claude-code' {
  interface PluginState {
    'config-snapshots': {
      snapshots: Snapshot[]
      selected: string | null
      output: string
      isArmed: boolean
      isBusy: boolean
    }
  }
}
