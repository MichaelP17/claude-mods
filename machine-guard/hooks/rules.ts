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
    if (verb === 'services' && has(args, 'start', 'restart', 'run')) {
      return 'brew services changes background services'
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
      case 'colima':
      case 'limactl':
        return verb !== undefined && ['start', 'restart', 'delete'].includes(verb)
          ? `${tool} ${verb} changes the container VM`
          : null
      case 'podman':
        return verb === 'machine' && has(args, 'start', 'init', 'rm') ? 'podman machine changes the container VM' : null
      case 'docker': {
        const changing = ['run', 'pull', 'start', 'build', 'create', 'load', 'import']
        if (verb === 'compose') {
          const composeVerb = subcommand(args.slice(args.indexOf('compose') + 1))
          return composeVerb !== undefined && ['up', 'pull', 'build', 'run', 'start', 'create'].includes(composeVerb)
            ? `docker compose ${composeVerb} starts containers or pulls images`
            : null
        }
        return verb !== undefined && changing.includes(verb) ? `docker ${verb} starts containers or pulls images` : null
      }
      case 'launchctl':
        return verb !== undefined && ['load', 'bootstrap', 'enable', 'kickstart', 'submit'].includes(verb)
          ? `launchctl ${verb} changes background services`
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

// A command like `cd app && brew install jq` is judged per segment, so a
// harmless first part never hides the changing one.
function splitSegments(command: string): string[] {
  return command
    .split(/&&|\|\||[;|\n]|\$\(|`/)
    .map(i => i.trim())
    .filter(i => i.length > 0)
}

function tokenize(segment: string): string[] {
  const tokens = segment.split(/\s+/).map(i => i.replace(/^['"]|['"]$/g, ''))
  let start = 0
  while (start < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[start] ?? '') || WRAPPERS.has(tokens[start] ?? ''))) {
    start += 1
  }

  return tokens.slice(start)
}

export function findMachineChanges(command: string): Finding[] {
  const findings: Finding[] = []

  if (/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/.test(command)) {
    findings.push({ segment: command.trim(), reason: 'pipes a downloaded script into a shell' })
  }

  for (const segment of splitSegments(command)) {
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
