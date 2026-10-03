import { describe, expect, test } from 'claude-code/testing'

import { parseTaskEnds, requestedLimits, takeReasonLine, takeReasonPrefix } from './limits'

describe('requestedLimits', () => {
  test('reads a German request', () => {
    expect(requestedLimits('Nutze 8 Subagents für die Recherche')).toEqual({ subagents: 8 })
  })

  test('reads an English request with "parallel"', () => {
    expect(requestedLimits('use up to 6 parallel agents and 5 monitors')).toEqual({ subagents: 6, monitors: 5 })
  })

  test('reads German plural forms', () => {
    expect(requestedLimits('starte 4 Monitore und 10 Subagenten')).toEqual({ subagents: 10, monitors: 4 })
  })

  test('reads number words', () => {
    expect(requestedLimits('Starte fünf Subagents, die jeweils warten')).toEqual({ subagents: 5 })
    expect(requestedLimits('use six parallel agents')).toEqual({ subagents: 6 })
  })

  test('does not read a number word inside another word', () => {
    expect(requestedLimits('Achtzehn Agents')).toEqual({})
  })

  test('ignores numbers that are not a request', () => {
    expect(requestedLimits('Der Agent hat 1500 Referenzen geladen')).toEqual({})
  })
})

describe('takeReasonLine', () => {
  test('splits the reason off the prompt', () => {
    expect(takeReasonLine('Over-limit reason: each song needs its own analysis\n\nAnalyse song 5.')).toEqual({
      reason: 'each song needs its own analysis',
      rest: 'Analyse song 5.',
    })
  })

  test('leaves a prompt without reason untouched', () => {
    expect(takeReasonLine('Analyse song 5.')).toEqual({ reason: null, rest: 'Analyse song 5.' })
  })
})

describe('takeReasonPrefix', () => {
  test('splits reason and description', () => {
    expect(takeReasonPrefix('Over-limit reason: the deploy and the tests run at once | watch deploy log')).toEqual({
      reason: 'the deploy and the tests run at once',
      rest: 'watch deploy log',
    })
  })

  test('leaves a plain description untouched', () => {
    expect(takeReasonPrefix('watch deploy log')).toEqual({ reason: null, rest: 'watch deploy log' })
  })
})

describe('parseTaskEnds', () => {
  test('finds ended tasks and skips running ones', () => {
    const text = [
      '<task-notification><task-id>m1</task-id><status>completed</status></task-notification>',
      '<task-notification><task-id>m2</task-id><status>running</status></task-notification>',
      '<task-notification>\n<task-id>m3</task-id>\n<status>killed</status>\n</task-notification>',
    ].join('\n')
    expect(parseTaskEnds(text)).toEqual([
      { taskId: 'm1', status: 'completed' },
      { taskId: 'm3', status: 'killed' },
    ])
  })
})
