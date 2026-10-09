// idea-shell rewrites ~/.claude/ideas/ whenever an idea is captured or done.
// Those changes travel with the next snapshot without a toast for each of them.
const QUIET_PREFIXES = ['ideas/']

export function hasConfigChanges(status: string): boolean {
  const [changes = ''] = status.split('\n\n')
  if (changes.startsWith('No config changes')) {
    return false
  }

  return changes
    .split('\n')
    .filter(i => i.trim().length > 0)
    .some(line => !QUIET_PREFIXES.some(prefix => pathOf(line).startsWith(prefix)))
}

// `git status --short` lines are two status letters, a space and the path,
// quoted when it holds unusual characters.
function pathOf(line: string): string {
  return line.slice(3).replace(/^"/, '')
}
