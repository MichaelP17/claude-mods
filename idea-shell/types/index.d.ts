export type Idea = string

declare module 'claude-code' {
  interface PluginState {
    'idea-shell': {
      ideas: Idea[]
    }
  }
}
