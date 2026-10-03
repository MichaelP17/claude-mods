export type ServiceCheck = {
  argv: string[]
  // exit-zero: running when the check exits 0; output: running when it prints anything;
  // brew: running when `brew services info --json` reports it so.
  rule: 'exit-zero' | 'output' | 'brew'
}

export type Service = {
  id: string
  label: string
  cwd: string
  startedAt: number
  stop: string[]
  check: ServiceCheck | null
}

declare module 'claude-code' {
  interface PluginState {
    'service-radar': {
      services: Service[]
      isBusy: boolean
      message: string
    }
  }
}
