export type HubAttention = 'none' | 'info' | 'warning'

export type HubAction = {
  key: string
  label: string
}

export type HubEntry = {
  id: string
  icon: string
  title: string
  status: string
  attention: HubAttention
  actions: HubAction[]
}

export type Hub = {
  set: (entry: HubEntry) => Promise<void>
  remove: (input: { id: string }) => Promise<void>
}

declare module 'claude-code' {
  interface EngineInterface {
    hub: Hub
  }

  interface PluginState {
    'mod-hub': {
      entries: HubEntry[]
    }
  }
}
