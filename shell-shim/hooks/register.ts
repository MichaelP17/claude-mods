import type { EngineInterface, Register } from 'claude-code'

import type { ShellFacts } from './shell'
import { parseFacts, rewrite } from './shell'

// Sources the snapshot the Bash tool sources and asks zsh itself: which aliases
// exist, which of them hide a program on PATH, and whether `timeout` is there.
const PROBE = [
  'source "$1" >/dev/null 2>&1',
  'print -r -- "timeout:$(whence -p timeout)"',
  'for name in ${(k)aliases}; do print -r -- "alias:$name"; whence -p -- "$name" >/dev/null 2>&1 && print -r -- "shadow:$name"; done',
].join('; ')

let cached: { key: string; facts: Promise<ShellFacts | null> } | undefined

async function newestSnapshot($: EngineInterface): Promise<{ path: string; key: string } | null> {
  const home = (await $.env.get('HOME')) ?? ''
  const directory = `${(await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`}/shell-snapshots`
  if (!(await $.fs.exists(directory))) {
    return null
  }
  const entries = await $.fs.list(directory)
  const newest = entries
    .filter(i => i.kind === 'file' && i.name.startsWith('snapshot-zsh-'))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]

  return newest === undefined ? null : { path: `${directory}/${newest.name}`, key: `${newest.name}:${newest.mtimeMs}` }
}

async function probe($: EngineInterface, snapshot: string): Promise<ShellFacts | null> {
  try {
    const result = await $.process.run(['/bin/zsh', '-fc', PROBE, 'shell-shim', snapshot], { timeoutMs: 10_000 })

    return result.stdout.includes('timeout:') ? parseFacts(result.stdout) : null
  } catch {
    return null
  }
}

// Only a zsh snapshot gets facts: under bash the commands already run the way
// Claude writes them.
async function factsOf($: EngineInterface): Promise<ShellFacts | null> {
  const snapshot = await newestSnapshot($)
  if (snapshot === null) {
    return null
  }
  if (cached?.key !== snapshot.key) {
    cached = { key: snapshot.key, facts: probe($, snapshot.path) }
  }

  return cached.facts
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    void factsOf($)

    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (typeof e.command !== 'string') {
      return next(e)
    }
    const facts = await factsOf($)
    const changed = facts === null ? null : rewrite(e.command, facts, `${$.plugin.root}/bin`)
    if (changed === null) {
      return next(e)
    }
    $.ui.log(`shell-shim: ${changed.fixes.join(', ')} · ${changed.command.slice(0, 300)}`, { to: 'debug' })

    return next({ ...e, command: changed.command })
  })
}
