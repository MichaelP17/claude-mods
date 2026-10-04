export type Finding = { segment: string; reason: string }

type Rule = (tool: string, args: readonly string[], segment: string) => string | null

const WRAPPERS = new Set(['command', 'exec', 'time', 'nohup', 'env'])

const GLOBAL_FLAGS = new Set(['-g', '--global'])

function has(args: readonly string[], ...values: string[]): boolean {
  return args.some(i => values.includes(i))
}

function subcommand(args: readonly string[]): string | undefined {
  return args.find(i => !i.startsWith('-'))
}

function isVirtualEnvironment(executable: string): boolean {
  return /(^|\/)\.?venv\//.test(executable)
}

const RULES: Rule[] = [
  tool => (tool === 'sudo' ? 'runs with root privileges' : null),

  (tool, args) => {
    if (tool !== 'brew') {
      return null
    }
    const verb = subcommand(args)
    const changing = ['install', 'reinstall', 'upgrade', 'uninstall', 'remove', 'rm', 'tap', 'untap', 'link',
      'unlink', 'cleanup', 'autoremove', 'migrate', 'update', 'pin', 'unpin']
    if (verb !== undefined && changing.includes(verb)) {
      return `brew ${verb} changes installed packages`
    }
    if (verb === 'bundle' && !has(args, 'dump', 'check', 'list')) {
      return 'brew bundle installs packages'
    }

    return null
  },

  (tool, args) => {
    if (!['npm', 'pnpm', 'yarn', 'bun'].includes(tool)) {
      return null
    }
    const isGlobal = args.some(i => GLOBAL_FLAGS.has(i)) || (tool === 'yarn' && args[0] === 'global')
    const verb = subcommand(tool === 'yarn' && args[0] === 'global' ? args.slice(1) : args)
    const changing = ['i', 'install', 'add', 'update', 'upgrade', 'uninstall', 'remove', 'rm', 'un', 'link']

    return isGlobal && verb !== undefined && changing.includes(verb) ? `${tool} ${verb} changes global packages` : null
  },

  (tool, args, segment) => {
    const executable = segment.trim().split(/\s+/)[0] ?? ''
    const isPip = tool === 'pip' || tool === 'pip3'
    const isPythonModule = /^python(3(\.\d+)?)?$/.test(tool) && args[0] === '-m' && args[1]?.startsWith('pip')
    if (!isPip && !isPythonModule) {
      return null
    }
    const pipArgs = isPythonModule ? args.slice(2) : args
    if (!has(pipArgs, 'install', 'uninstall') || isVirtualEnvironment(executable)) {
      return null
    }

    return 'pip changes packages outside a virtual environment'
  },

  (tool, args) => {
    const verb = subcommand(args)
    switch (tool) {
      case 'pipx':
      case 'gem':
      case 'cargo':
      case 'go':
        return verb !== undefined && ['install', 'uninstall', 'upgrade', 'inject', 'ensurepath'].includes(verb)
          ? `${tool} ${verb} changes installed tools`
          : null
      case 'uv':
        return (verb === 'tool' || verb === 'python') && has(args, 'install', 'uninstall', 'upgrade')
          ? `uv ${verb} changes installed tools`
          : null
      case 'dotnet':
        return (verb === 'tool' && has(args, 'install', 'update', 'uninstall') && args.some(i => GLOBAL_FLAGS.has(i)))
          || (verb === 'workload' && has(args, 'install', 'update', 'uninstall'))
          ? `dotnet ${verb} changes installed tools`
          : null
      case 'mise':
      case 'asdf':
      case 'nvm':
      case 'rustup':
        return verb !== undefined && ['install', 'use', 'upgrade', 'uninstall', 'prune', 'update', 'plugins', 'plugin',
          'default', 'toolchain', 'global'].includes(verb)
          ? `${tool} ${verb} changes installed runtimes or their configuration`
          : null
      case 'winget':
      case 'choco':
      case 'scoop':
        return verb !== undefined && ['install', 'uninstall', 'upgrade', 'update', 'remove'].includes(verb)
          ? `${tool} ${verb} changes installed packages`
          : null
      default:
        return null
    }
  },

  (tool, args) => {
    const verb = subcommand(args)
    switch (tool) {
      // Starting and stopping services is left to service-radar, which tracks
      // what was started; only creating, deleting and downloading stays here.
      case 'colima':
      case 'limactl':
        return verb === 'delete' ? `${tool} delete removes a VM and its data` : null
      case 'podman':
        return verb === 'machine' && has(args, 'init', 'rm') ? 'podman machine creates or removes a VM' : null
      case 'docker': {
        if (verb === 'compose') {
          const composeVerb = subcommand(args.slice(args.indexOf('compose') + 1))
          return composeVerb !== undefined && ['pull', 'build', 'create'].includes(composeVerb)
            ? `docker compose ${composeVerb} downloads or builds images`
            : null
        }
        return verb !== undefined && ['pull', 'build', 'create', 'load', 'import'].includes(verb)
          ? `docker ${verb} downloads or builds images`
          : null
      }
      case 'launchctl':
        return verb !== undefined && ['enable', 'submit'].includes(verb)
          ? `launchctl ${verb} changes background services permanently`
          : null
      default:
        return null
    }
  },

  (tool, args) => {
    switch (tool) {
      case 'softwareupdate':
        return has(args, '-i', '--install', '-a', '--all', '--install-rosetta') ? 'softwareupdate installs system software' : null
      case 'xcode-select':
        return has(args, '--install', '-s', '--switch', '-r', '--reset') ? 'xcode-select changes the developer tools' : null
      case 'defaults':
        return has(args, 'write', 'delete') ? 'defaults changes system or app preferences' : null
      case 'chsh':
        return 'chsh changes the login shell'
      case 'git': {
        const index = args.indexOf('config')
        if (index === -1 || !has(args, '--global', '--system')) {
          return null
        }
        const isRead = has(args, '--get', '--get-all', '--get-regexp', '--list', '-l', '--show-origin')
        const valueArgs = args.slice(index + 1).filter(i => !i.startsWith('-'))

        return !isRead && valueArgs.length >= 2 ? 'git config changes the global git configuration' : null
      }
      default:
        return null
    }
  },
]

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'ssh', 'sudo', 'xargs', 'eval', 'source', '.'])

// A heredoc body is data for the program it is fed to; only a shell turns it
// back into commands. Bodies fed to anything else (python3, cat, tee) are left
// out of the check, so writing documentation that mentions commands is not
// mistaken for running them.
export function stripHeredocs(command: string): string {
  const lines = command.split('\n')
  const kept: string[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    kept.push(line)
    index += 1
    const marker = /<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/.exec(line)
    if (marker === null) {
      continue
    }
    const segment = line.slice(0, marker.index).split(/&&|\|\||[;|]/).pop() ?? ''
    const program = segment.trim().split(/\s+/).find(i => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(i)) ?? ''
    const pipesIntoShell = /\|\s*(sudo\s+)?(ba|z|da)?sh\b/.test(line.slice(marker.index))
    if (SHELLS.has(program.split('/').pop() ?? '') || pipesIntoShell) {
      continue
    }
    const delimiter = marker[3]
    const stripsTabs = marker[1] === '-'
    while (index < lines.length) {
      const body = lines[index] ?? ''
      index += 1
      if ((stripsTabs ? body.replace(/^\t+/, '') : body) === delimiter) {
        kept.push(body)
        break
      }
    }
  }

  return kept.join('\n')
}

type Segment = { text: string; isPiped: boolean }

// A command like `cd app && brew install jq` is judged per segment, so a
// harmless first part never hides the changing one. Separators inside quotes
// are data, as in `grep 'brew install\|npm i -g'`; only `$(` and backticks
// still open a command inside double quotes.
function scanSegments(command: string): Segment[] {
  const segments: Segment[] = []
  let current = ''
  let isPiped = false
  let quote: '\'' | '"' | null = null
  const close = (nextIsPiped: boolean) => {
    if (current.trim().length > 0) {
      segments.push({ text: current.trim(), isPiped })
    }
    current = ''
    isPiped = nextIsPiped
  }
  let index = 0
  while (index < command.length) {
    const char = command[index] ?? ''
    const pair = command.slice(index, index + 2)
    if (quote === '\'') {
      current += char
      quote = char === '\'' ? null : quote
      index += 1
    } else if (char === '\\') {
      current += pair
      index += 2
    } else if (pair === '$(' || char === '`') {
      close(false)
      index += char === '`' ? 1 : 2
    } else if (quote === '"') {
      current += char
      quote = char === '"' ? null : quote
      index += 1
    } else if (char === '\'' || char === '"') {
      current += char
      quote = char
      index += 1
    } else if (pair === '&&' || pair === '||') {
      close(false)
      index += 2
    } else if (char === '|') {
      close(true)
      index += 1
    } else if (char === ';' || char === '\n') {
      close(false)
      index += 1
    } else {
      current += char
      index += 1
    }
  }
  close(false)

  return segments
}

function splitSegments(command: string): string[] {
  return scanSegments(command).map(i => i.text)
}

function tokenize(segment: string): string[] {
  const tokens = segment.split(/\s+/).map(i => i.replace(/^['"]|['"]$/g, ''))
  let start = 0
  while (start < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[start] ?? '') || WRAPPERS.has(tokens[start] ?? ''))) {
    start += 1
  }

  return tokens.slice(start)
}

export function findMachineChanges(fullCommand: string): Finding[] {
  const findings: Finding[] = []
  const command = stripHeredocs(fullCommand)

  const segments = scanSegments(command)
  segments.forEach((segment, index) => {
    const [downloader] = tokenize(segment.text)
    const next = segments[index + 1]
    const [shell, ...shellArgs] = next?.isPiped === true ? tokenize(next.text) : []
    const runner = shell === 'sudo' ? shellArgs[0] : shell
    if ((downloader === 'curl' || downloader === 'wget') && runner !== undefined && /^(ba|z|da)?sh$/.test(runner)) {
      findings.push({ segment: command.trim(), reason: 'pipes a downloaded script into a shell' })
    }
  })

  for (const { text: segment } of segments) {
    const [first, ...args] = tokenize(segment)
    if (first === undefined) {
      continue
    }
    const tool = first.split('/').pop() ?? first
    for (const rule of RULES) {
      const reason = rule(tool, args, segment)
      if (reason !== null) {
        findings.push({ segment, reason })
        break
      }
    }
  }

  return findings
}

export type ProjectRule = { match: string; reason: string }

export type ProjectConfig = { block: ProjectRule[]; ask: ProjectRule[] }

export function findProjectMatches(command: string, rules: readonly ProjectRule[]): ProjectRule[] {
  const segments = splitSegments(command)

  return rules.filter(rule => segments.some(segment => new RegExp(rule.match).test(segment)))
}
