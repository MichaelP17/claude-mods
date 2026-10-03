import type { EngineInterface, Register } from 'claude-code'

import { findMachineChanges, findProjectMatches } from './rules'
import type { ProjectConfig } from './rules'

const ALLOW = 'Allow once'
const DENY = 'Deny'
const PROJECT_CONFIG_PATH = '.claude/machine-guard.json'

async function readProjectConfig($: EngineInterface): Promise<ProjectConfig> {
  const path = `${await $.session.cwd()}/${PROJECT_CONFIG_PATH}`
  if (!(await $.fs.exists(path))) {
    return { block: [], ask: [] }
  }
  try {
    const parsed = JSON.parse(await $.fs.read(path)) as Partial<ProjectConfig>

    return { block: parsed.block ?? [], ask: parsed.ask ?? [] }
  } catch {
    $.ui.log(`machine-guard: ${PROJECT_CONFIG_PATH} is not valid JSON and is ignored.`)

    return { block: [], ask: [] }
  }
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const config = await readProjectConfig($)

    const blocked = findProjectMatches(e.command, config.block)[0]
    if (blocked !== undefined) {
      return { deny: `Blocked in this project by ${PROJECT_CONFIG_PATH}: ${blocked.reason}` }
    }

    const machineReasons = [...new Set(findMachineChanges(e.command).map(i => i.reason))]
    const projectReasons = [...new Set(findProjectMatches(e.command, config.ask).map(i => i.reason))]
    if (machineReasons.length === 0 && projectReasons.length === 0) {
      return next(e)
    }

    const commandPreview = e.command.length > 300 ? `${e.command.slice(0, 300)}…` : e.command
    const intro = machineReasons.length > 0
      ? `Claude wants to run a command that changes this machine (${machineReasons.join('; ')}):`
      : 'Claude wants to run a command this project asks about:'
    const projectNote = projectReasons.length > 0 ? `\n\nProject: ${projectReasons.join('; ')}` : ''

    // The dialog goes to the person directly: answering `ask` from tool.check
    // instead would hand the decision to auto mode, which may approve it alone.
    let answer: string
    try {
      answer = await $.ui.ask(`${intro}\n\n${commandPreview}${projectNote}\n\nAllow it?`, {
        options: [ALLOW, DENY],
        header: 'Machine',
      })
    } catch {
      answer = DENY
    }

    if (answer === ALLOW) {
      return next(e)
    }

    const reasons = [...machineReasons, ...projectReasons].join('; ')
    const note = answer === DENY ? '' : ` The user answered: "${answer}".`

    return {
      deny: `The user did not approve this command (${reasons}).${note} Do not run it another way; give the user the command in a code block instead and wait.`,
    }
  })
}
