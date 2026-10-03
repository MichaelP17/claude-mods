import { expect, test } from 'claude-code/testing'

const BASH_OK = { result: { stdout: 'ran', stderr: '', interrupted: false } }

test('asks the user and runs the command only after "Allow once"', async ($, on) => {
  const ran: string[] = []
  const asked: string[] = []
  let answer = 'Allow once'

  on('session.cwd', () => ({ value: '/tmp/project' }))
  on('fs.exists', () => ({ value: false }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const question = e.questions[0]?.question ?? ''
    asked.push(question)

    return { result: { questions: e.questions, answers: { [question]: answer } } }
  })
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    ran.push(e.command)

    return BASH_OK
  })

  await $.tool.call({ tool: 'Bash', command: 'brew install jq' })
  expect(asked).toHaveLength(1)
  expect(ran).toEqual(['brew install jq'])

  answer = 'Deny'
  const denied = await $.tool.call({ tool: 'Bash', command: 'brew install jq' })
  expect(ran).toEqual(['brew install jq'])
  expect(denied.text ?? denied.deny ?? '').toContain('did not approve')

  answer = 'Use mise instead'
  const redirected = await $.tool.call({ tool: 'Bash', command: 'npm i -g typescript' })
  expect(redirected.text ?? redirected.deny ?? '').toContain('Use mise instead')
})

test('lets harmless commands through without asking', async ($, on) => {
  const asked: string[] = []
  on('session.cwd', () => ({ value: '/tmp/project' }))
  on('fs.exists', () => ({ value: false }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    asked.push(e.questions[0]?.question ?? '')

    return { result: { questions: e.questions, answers: {} } }
  })
  on('tool.call', { tool: 'Bash' }, () => BASH_OK)

  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(asked).toHaveLength(0)
})

test('a project rule blocks without asking', async ($, on) => {
  const asked: string[] = []
  on('session.cwd', () => ({ value: '/tmp/project' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({
    value: JSON.stringify({ block: [{ match: '^docker\\b', reason: 'Tested on another machine' }] }),
  }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    asked.push(e.questions[0]?.question ?? '')

    return { result: { questions: e.questions, answers: {} } }
  })
  on('tool.call', { tool: 'Bash' }, () => BASH_OK)

  const result = await $.tool.call({ tool: 'Bash', command: 'docker ps' })
  expect(result.text ?? result.deny ?? '').toContain('Tested on another machine')
  expect(asked).toHaveLength(0)
})

test('a project ask rule shows its reason in one dialog, also for globally harmless commands', async ($, on) => {
  const asked: string[] = []
  const ran: string[] = []
  on('session.cwd', () => ({ value: '/tmp/project' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({
    value: JSON.stringify({
      ask: [
        { match: '^dotnet run\\b', reason: 'Starts a local instance without data' },
        { match: '^docker\\b', reason: 'Tested on the Windows PC' },
      ],
    }),
  }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const question = e.questions[0]?.question ?? ''
    asked.push(question)

    return { result: { questions: e.questions, answers: { [question]: 'Allow once' } } }
  })
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    ran.push(e.command)

    return BASH_OK
  })

  await $.tool.call({ tool: 'Bash', command: 'dotnet run --project src/Api' })
  expect(asked).toHaveLength(1)
  expect(asked[0]).toContain('Starts a local instance without data')
  expect(ran).toEqual(['dotnet run --project src/Api'])

  await $.tool.call({ tool: 'Bash', command: 'docker compose up -d' })
  expect(asked).toHaveLength(2)
  expect(asked[1]).toContain('docker compose up starts containers or pulls images')
  expect(asked[1]).toContain('Tested on the Windows PC')

  await $.tool.call({ tool: 'Bash', command: 'dotnet build' })
  expect(asked).toHaveLength(2)
})

test('a failing check refuses the command instead of running it', async ($, on) => {
  const ran: string[] = []
  on('session.cwd', () => {
    throw new Error('no working directory')
  })
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    ran.push(e.command)

    return BASH_OK
  })

  const result = await $.tool.call({ tool: 'Bash', command: 'brew install jq' })
  expect(result.text ?? result.deny ?? '').toContain('could not check this command')
  expect(ran).toHaveLength(0)
})
