// mod-hub's contract, restated: listed under dependencies, it would keep this
// mod from loading where mod-hub is not installed.
export type HubEntry = {
  icon: string
  title: string
  status: string
  attention: 'none' | 'info' | 'warning'
  actions: { key: string; label: string }[]
}

export type HubCall = { hub: { set: (entry: HubEntry & { id: string }) => Promise<void> } }
