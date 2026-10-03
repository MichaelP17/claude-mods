import type { ServiceCheck } from '../types'

export type Detected = { label: string; cwd: string; stop: string[]; check: ServiceCheck | null }

const COMPOSE_GLOBAL_FLAGS = new Set(['-f', '--file', '-p', '--project-name', '--profile', '--env-file', '--project-directory'])

function splitSegments(command: string): string[] {
  return command
    .split(/&&|\|\||[;\n]/)
    .map(i => i.trim())
    .filter(i => i.length > 0)
}

function tokenize(segment: string): string[] {
  const tokens = (segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(i => i.replace(/^(["'])(.*)\1$/, '$2'))
  let start = 0
  while (start < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[start] ?? '') || tokens[start] === 'sudo')) {
    start += 1
  }

  return tokens.slice(start)
}

export function resolvePath(base: string, target: string, home: string): string {
  if (target === '~' || target.startsWith('~/')) {
    return `${home}${target.slice(1)}`
  }
  if (target.startsWith('/')) {
    return target
  }
  const parts = base.split('/')
  for (const part of target.split('/')) {
    if (part === '..') {
      parts.pop()
    } else if (part !== '.' && part !== '') {
      parts.push(part)
    }
  }

  return parts.join('/') || '/'
}

function folderName(path: string): string {
  return path.split('/').filter(i => i.length > 0).pop() ?? path
}

function detectCompose(args: readonly string[], cwd: string): Detected | null {
  const globalFlags: string[] = []
  let index = 0
  while (index < args.length && args[index]?.startsWith('-')) {
    const flag = args[index] ?? ''
    globalFlags.push(flag)
    if (COMPOSE_GLOBAL_FLAGS.has(flag) && args[index + 1] !== undefined) {
      globalFlags.push(args[index + 1] ?? '')
      index += 1
    }
    index += 1
  }
  if (args[index] !== 'up') {
    return null
  }
  const upArgs = args.slice(index + 1)
  if (!upArgs.some(i => i === '-d' || i === '--detach' || /^-[a-z]*d[a-z]*$/.test(i))) {
    return null
  }
  const projectIndex = globalFlags.findIndex(i => i === '-p' || i === '--project-name')
  const project = projectIndex === -1 ? folderName(cwd) : globalFlags[projectIndex + 1] ?? folderName(cwd)

  return {
    label: `docker compose: ${project}`,
    cwd,
    stop: ['docker', 'compose', ...globalFlags, 'down'],
    check: { argv: ['docker', 'compose', ...globalFlags, 'ps', '--status', 'running', '-q'], rule: 'output' },
  }
}

function detectDockerRun(args: readonly string[], cwd: string, output: string): Detected | null {
  if (!args.some(i => i === '-d' || i === '--detach' || /^-[a-z]*d[a-z]*$/.test(i))) {
    return null
  }
  const nameIndex = args.findIndex(i => i === '--name')
  const inlineName = args.find(i => i.startsWith('--name='))?.slice('--name='.length)
  const name = inlineName ?? (nameIndex === -1 ? undefined : args[nameIndex + 1])
  const containerId = /^([0-9a-f]{12,64})\s*$/m.exec(output)?.[1]
  const reference = name ?? containerId?.slice(0, 12)
  if (reference === undefined) {
    return null
  }

  return {
    label: `docker container: ${reference}`,
    cwd,
    stop: ['docker', 'stop', reference],
    check: { argv: ['docker', 'ps', '-q', '--filter', name === undefined ? `id=${reference}` : `name=^${name}$`], rule: 'output' },
  }
}

export function detectServices(command: string, startCwd: string, home: string, output: string): Detected[] {
  const found: Detected[] = []
  let cwd = startCwd

  for (const segment of splitSegments(command)) {
    const [tool, ...args] = tokenize(segment)
    if (tool === undefined) {
      continue
    }
    if (tool === 'cd') {
      cwd = resolvePath(cwd, args[0] ?? '~', home)
      continue
    }

    let detected: Detected | null = null
    if (tool === 'docker' && args[0] === 'compose') {
      detected = detectCompose(args.slice(1), cwd)
    } else if (tool === 'docker-compose') {
      detected = detectCompose(args, cwd)
    } else if (tool === 'docker' && args[0] === 'run') {
      detected = detectDockerRun(args.slice(1), cwd, output)
    } else if (tool === 'colima' && args[0] === 'start') {
      const profileIndex = args.findIndex(i => i === '-p' || i === '--profile')
      const profile = profileIndex === -1 ? args.slice(1).find(i => !i.startsWith('-')) : args[profileIndex + 1]
      const profileArgs = profile === undefined ? [] : [profile]
      detected = {
        label: profile === undefined ? 'colima' : `colima: ${profile}`,
        cwd,
        stop: ['colima', 'stop', ...profileArgs],
        check: { argv: ['colima', 'status', ...profileArgs], rule: 'exit-zero' },
      }
    } else if (tool === 'brew' && args[0] === 'services' && ['start', 'run', 'restart'].includes(args[1] ?? '')) {
      const formula = args.slice(2).find(i => !i.startsWith('-'))
      if (formula !== undefined) {
        detected = {
          label: `brew service: ${formula}`,
          cwd,
          stop: ['brew', 'services', 'stop', formula],
          check: { argv: ['brew', 'services', 'info', formula, '--json'], rule: 'brew' },
        }
      }
    } else if (tool === 'launchctl' && args[0] === 'load') {
      const path = args.slice(1).find(i => !i.startsWith('-'))
      if (path !== undefined) {
        const absolute = resolvePath(cwd, path, home)
        detected = { label: `launch agent: ${folderName(absolute)}`, cwd, stop: ['launchctl', 'unload', absolute], check: null }
      }
    }

    if (detected !== null) {
      found.push(detected)
    }
  }

  return found
}

export function isRunning(rule: ServiceCheck['rule'], exitCode: number, stdout: string): boolean {
  switch (rule) {
    case 'exit-zero':
      return exitCode === 0
    case 'output':
      return exitCode === 0 && stdout.trim().length > 0
    case 'brew':
      try {
        const parsed = JSON.parse(stdout) as Array<{ running?: boolean }>

        return parsed.some(i => i.running === true)
      } catch {
        return false
      }
  }
}

// Commands that may end a tracked service; after one of them every service is checked again.
export function mayStopServices(command: string): boolean {
  return /\b(down|stop|kill|unload|bootout|rm|prune)\b/.test(command)
}
