export type Question = {
  number: number
  title: string
  body: string
  recommendation: string | null
}

export type Answer = { kind: 'text'; text: string } | { kind: 'recommendation' }

export type Mode = 'answer' | 'review' | 'confirm-send' | 'confirm-discard' | 'sending'

export type Round = {
  key: string
  questions: Question[]
  answers: (Answer | null)[]
  skipped: boolean[]
  current: number
  mode: Mode
  prefill: string | null
}

export type StoredRound = {
  status: 'open' | 'done'
  answers: (Answer | null)[]
  updatedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'grill-panel': {
      round: Round | null
    }
  }
}
