import { expect, test } from 'claude-code/testing'

const AGENT_DONE = { result: { status: 'async_launched' } }

function runningAgents(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `agent-${i}`,
    description: `task ${i}`,
    type: 'general-purpose',
    status: 'running',
  }))
}

test('below the limit a subagent starts without asking', async ($, on) => {
  const asked: string[] = []
  const started: string[] = []
  on('agent.list', () => ({ value: runningAgents(3) }))
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    asked.push(e.questions[0]?.question ?? '')

    return { result: { questions: e.questions, answers: {} } }
  })
  on('tool.call', { tool: 'Agent' }, (_$, e) => {
    started.push(e.prompt)

    return AGENT_DONE
  })

  await $.tool.call({ tool: 'Agent', description: 'fourth', prompt: 'Do task 4.', subagent_type: 'general-purpose' })
  expect(asked).toHaveLength(0)
  expect(started).toEqual(['Do task 4.'])
})

test('at the limit a call without reason is refused, a reasoned retry asks the user', async ($, on) => {
  const asked: string[] = []
  const started: string[] = []
  let answer = 'Allow once'
  on('agent.list', () => ({ value: runningAgents(4) }))
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const question = e.questions[0]?.question ?? ''
    asked.push(question)

    return { result: { questions: e.questions, answers: { [question]: answer } } }
  })
  on('tool.call', { tool: 'Agent' }, (_$, e) => {
    started.push(e.prompt)

    return AGENT_DONE
  })

  const refused = await $.tool.call({ tool: 'Agent', description: 'fifth', prompt: 'Do task 5.', subagent_type: 'general-purpose' })
  expect(refused.text ?? refused.deny ?? '').toContain('Over-limit reason:')
  expect(asked).toHaveLength(0)
  expect(started).toHaveLength(0)

  await $.tool.call({
    tool: 'Agent',
    description: 'fifth',
    prompt: 'Over-limit reason: the five songs are independent\nDo task 5.',
    subagent_type: 'general-purpose',
  })
  expect(asked).toHaveLength(1)
  expect(asked[0]).toContain('the five songs are independent')
  expect(started).toEqual(['Do task 5.'])

  answer = 'Deny'
  const denied = await $.tool.call({
    tool: 'Agent',
    description: 'sixth',
    prompt: 'Over-limit reason: more songs\nDo task 6.',
    subagent_type: 'general-purpose',
  })
  expect(denied.text ?? denied.deny ?? '').toContain('did not approve')
  expect(started).toEqual(['Do task 5.'])
})

test('monitors count against their own limit', async ($, on) => {
  const asked: string[] = []
  let next = 0
  on('agent.list', () => ({ value: [] }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1_000 }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    asked.push(e.questions[0]?.question ?? '')

    return { result: { questions: e.questions, answers: {} } }
  })
  on('tool.call', { tool: 'Monitor' }, () => {
    next += 1

    return { result: { taskId: `m${next}`, timeoutMs: 300_000 } }
  })

  for (let i = 0; i < 3; i += 1) {
    await $.tool.call({ tool: 'Monitor', description: `watch ${i}`, timeout_ms: 300_000, command: 'tail -f log' })
  }
  const refused = await $.tool.call({ tool: 'Monitor', description: 'watch 4', timeout_ms: 300_000, command: 'tail -f log' })
  expect(refused.text ?? refused.deny ?? '').toContain('Concurrency limit reached: 3 monitors')
  expect(next).toBe(3)
  expect(asked).toHaveLength(0)
})

test('five subagents started in one message respect a limit of four', async ($, on) => {
  const started: string[] = []
  on('agent.list', () => ({ value: runningAgents(started.length) }))
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', { tool: 'Agent' }, (_$, e) => {
    started.push(e.description)

    return AGENT_DONE
  })

  const results = await Promise.all(
    [1, 2, 3, 4, 5].map(i =>
      $.tool.call({ tool: 'Agent', description: `wait ${i}`, prompt: 'Wait 20 seconds.', subagent_type: 'general-purpose' }),
    ),
  )
  expect(started).toHaveLength(4)
  expect(results.filter(i => (i.text ?? i.deny ?? '').includes('Concurrency limit reached'))).toHaveLength(1)
})
