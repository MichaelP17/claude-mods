export type Role = 'lead' | 'worker'

export type Link = {
  role: Role
  channel: string
}

export type Task = {
  id: string
  text: string
  isFresh: boolean
  sentAt: number
}

export type Answer = {
  id: string
  text: string
  finishedAt: number
}

export type Presence = {
  sessionId: string
  busySince: number | null
  seenAt: number
}

export type Offer = {
  blocks: string[]
  index: number
}

declare module 'claude-code' {
  interface PluginState {
    'session-relay': {
      link: Link | null
      tasks: Task[]
      answers: Answer[]
      offer: Offer | null
      isAttached: boolean
      presence: Presence | null
      isActive: boolean
      footer: string | null
    }
  }
}
