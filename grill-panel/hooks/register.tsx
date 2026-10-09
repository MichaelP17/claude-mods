import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Question, Round, StoredRound } from '../types'
import {
  FORMAT_CONTRACT,
  answerCurrent,
  answerOf,
  editAt,
  formatAnswers,
  goBack,
  isStoredRound,
  lastRoundIn,
  latestRoundIn,
  newRound,
  openCount,
  parseQuestions,
  prefillRecommendation,
  previewOf,
  resume,
  roundKeyOf,
  skipCurrent,
  statusOf,
} from './rounds'

const PANE = 'grill'
const TITLE = 'Grill'
const STORE_PREFIX = 'round:'
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

const round = atom({ plugin: 'grill-panel', key: 'round' } as const, null)

async function loadStored($: EngineInterface, key: string): Promise<StoredRound | undefined> {
  const value = await $.store.get(key)

  return isStoredRound(value) ? value : undefined
}

async function save($: EngineInterface, value: Round, status: StoredRound['status']): Promise<void> {
  const stored: StoredRound = { status, answers: value.answers, updatedAt: await $.clock.now() }
  await $.store.set(value.key, stored)
}

async function prune($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const keys = await $.store.keys()
  for (const key of keys) {
    if (!key.startsWith(STORE_PREFIX)) {
      continue
    }
    const stored = await loadStored($, key)
    if (stored === undefined || now - stored.updatedAt > RETENTION_MS) {
      await $.store.delete(key)
    }
  }
}

function showStatus($: EngineInterface, value: Round | null): void {
  $.ui.status(value === null ? undefined : statusOf(value))
}

async function openPane($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })
}

// Moving the ring is a convenience: where it cannot move (a site without the
// keys, the test kit, which has no ring) the press that asked still counts.
async function focus($: EngineInterface, key: string): Promise<void> {
  await $.ui.focus({ requestId: PANE, key }).catch(() => undefined)
}

// A round already sent or discarded stays closed unless the person asks for it
// again with /grill (`isRevived`).
async function begin($: EngineInterface, questions: readonly Question[], isRevived: boolean): Promise<boolean> {
  const root = await $.session.root()
  const key = `${STORE_PREFIX}${roundKeyOf(root, questions)}`
  const current = await read($, round)
  if (current?.key === key) {
    return true
  }
  const stored = await loadStored($, key)
  if (stored?.status === 'done' && !isRevived) {
    return false
  }
  const value = newRound(key, questions, stored?.answers ?? [])
  await update($, round, () => value)
  showStatus($, value)
  if (stored?.status === 'done') {
    await save($, value, 'open')
  }

  return true
}

async function restore($: EngineInterface): Promise<void> {
  const current = await read($, round)
  if (current !== null) {
    return
  }
  const messages = await $.session.messages()
  const questions = lastRoundIn(messages)
  if (questions.length > 0 && (await begin($, questions, false))) {
    await openPane($)
  }
}

async function reset($: EngineInterface): Promise<void> {
  await update($, round, () => null)
  showStatus($, null)
  await $.ui.close({ id: PANE })
}

async function finish($: EngineInterface, value: Round): Promise<void> {
  await save($, value, 'done')
  await reset($)
}

async function change($: EngineInterface, apply: (value: Round) => Round): Promise<Round | null> {
  const value = await update($, round, current => (current === null ? null : apply(current)))
  showStatus($, value)

  return value
}

async function submit($: EngineInterface, text: string): Promise<void> {
  const before = await read($, round)
  const question = before?.questions[before.current]
  if (before?.mode !== 'answer' || question === undefined) {
    return
  }
  if (answerOf(text, question) === null) {
    $.ui.toast('This question has no recommendation to take; type an answer.')
    return
  }
  const value = await change($, current => answerCurrent(current, text))
  if (value === null) {
    return
  }
  await save($, value, 'open')
  if (value.mode === 'review') {
    await focus($, 'send')
  }
}

async function skip($: EngineInterface): Promise<void> {
  const value = await change($, skipCurrent)
  await focus($, value?.mode === 'review' ? 'send' : 'answer')
}

async function back($: EngineInterface): Promise<void> {
  await change($, goBack)
  await focus($, 'answer')
}

async function edit($: EngineInterface, index: number): Promise<void> {
  await change($, current => editAt(current, index))
  await focus($, 'answer')
}

async function useRecommendation($: EngineInterface): Promise<void> {
  await change($, prefillRecommendation)
  await focus($, 'answer')
}

async function requestSend($: EngineInterface): Promise<void> {
  const value = await read($, round)
  if (value === null) {
    return
  }
  if (openCount(value) === 0) {
    await send($)
    return
  }
  await change($, current => ({ ...current, mode: 'confirm-send', prefill: null }))
  await focus($, 'confirm-send')
}

async function send($: EngineInterface): Promise<void> {
  const value = await read($, round)
  if (value === null || value.mode === 'sending') {
    return
  }
  await change($, current => ({ ...current, mode: 'sending' }))
  try {
    await $.prompt.submit({ text: formatAnswers(value), asUser: true })
  } catch (error) {
    await change($, resume)
    $.ui.toast(`grill-panel could not send the answers; they are kept. ${String(error)}`)
    return
  }
  await finish($, value)
}

async function requestDiscard($: EngineInterface): Promise<void> {
  await change($, current => ({ ...current, mode: 'confirm-discard', prefill: null }))
  await focus($, 'cancel')
}

async function discard($: EngineInterface): Promise<void> {
  const value = await read($, round)
  if (value !== null) {
    await finish($, value)
  }
}

async function cancel($: EngineInterface): Promise<void> {
  const value = await change($, resume)
  await focus($, value?.mode === 'review' ? 'send' : 'answer')
}

function markOf(value: Round, index: number): string {
  if (value.answers[index] !== null) {
    return '✓'
  }
  if (index === value.current && value.mode === 'answer') {
    return '›'
  }

  return value.skipped[index] === true ? '↷' : '·'
}

function headingOf(question: Question): string {
  return question.title.length > 0 ? `Q${question.number} · ${question.title}` : `Q${question.number}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'grill',
      description: 'Open the panel for the open question round, or bring back the latest one',
      immediate: true,
    })
    await prune($)
    await restore($)

    return next(e)
  })

  // An in-process /resume or /clear starts no new session.start; the round on
  // screen belongs to the conversation that was left.
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (e.source === 'clear' || e.source === 'resume') {
      await reset($)
    }
    if (e.source === 'resume') {
      await restore($)
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer') {
      return result
    }
    const questions = parseQuestions(e.answer)
    if (questions.length > 0 && (await begin($, questions, false))) {
      await openPane($)
    }

    return result
  })

  on('skill.prompt', { skill: 'grilling' }, async ($, e, next) => {
    const result = await next(e)

    return { text: `${result.text}\n\n${FORMAT_CONTRACT}` }
  })

  on('command.run', { command: 'grill' }, async $ => {
    const current = await read($, round)
    if (current === null) {
      const messages = await $.session.messages()
      const questions = latestRoundIn(messages)
      if (questions.length === 0) {
        $.ui.toast('No question round in this conversation.')
        return {}
      }
      await begin($, questions, true)
    }
    await openPane($)

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const value = await read($, round)
    if (e.surface === 'mobile') {
      const { Text } = $.ui.resolve(e)

      return <Text dimColor>This app draws no text field; answer this round in the terminal or the desktop app.</Text>
    }
    const { Box, Button, Input, Markdown, Text } = $.ui.resolve(e)
    if (value === null) {
      return <Text dimColor>No open question round. /grill brings back the latest one.</Text>
    }
    const total = value.questions.length
    const open = openCount(value)

    if (value.mode === 'sending') {
      return <Text dimColor>Sending… Claude gets the answers as soon as it is free.</Text>
    }

    if (value.mode === 'confirm-send') {
      return (
        <Box flexDirection="column">
          <Text>{`${open} of ${total} questions are unanswered and go out as "(unanswered)".`}</Text>
          <Box flexDirection="row" columnGap={2} marginTop={1}>
            <Button key="confirm-send" variant="primary" autoFocus label="Send anyway" onPress={() => send($)} />
            <Button key="cancel" label="Keep answering" onPress={() => cancel($)} />
          </Box>
        </Box>
      )
    }

    if (value.mode === 'confirm-discard') {
      return (
        <Box flexDirection="column">
          <Text>Discard this round? The panel stops offering it; /grill brings it back with its answers.</Text>
          <Box flexDirection="row" columnGap={2} marginTop={1}>
            <Button key="cancel" autoFocus label="Keep round" onPress={() => cancel($)} />
            <Button key="confirm-discard" label="Discard" onPress={() => discard($)} />
          </Box>
        </Box>
      )
    }

    if (value.mode === 'review') {
      return (
        <Box flexDirection="column">
          <Text bold>{open === 0 ? 'All questions answered' : `${open} of ${total} unanswered`}</Text>
          {value.questions.map((question, index) => (
            <Button
              key={`edit-${index}`}
              plain
              {...(index < 9 ? { hotkey: String(index + 1) } : {})}
              onPress={() => edit($, index)}
            >
              {`${headingOf(question)}: `}
              <Text dimColor>{previewOf(value.answers[index] ?? null)}</Text>
            </Button>
          ))}
          <Box flexDirection="row" columnGap={2} marginTop={1}>
            <Button key="send" variant="primary" autoFocus label="Send to Claude" onPress={() => requestSend($)} />
            <Button key="discard" dimColor label="Discard round" onPress={() => requestDiscard($)} />
          </Box>
          <Text dimColor>A digit edits that answer · Enter sends</Text>
        </Box>
      )
    }

    const question = value.questions[value.current]
    if (question === undefined) {
      return <Text dimColor>No open question round. /grill brings back the latest one.</Text>
    }
    const answer = value.answers[value.current] ?? null
    const previous = value.questions[value.current - 1]
    const placeholder =
      question.recommendation === null
        ? 'Your answer'
        : answer?.kind === 'recommendation'
          ? 'Enter keeps the recommendation'
          : 'Your answer · Enter on an empty field takes the recommendation'

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" marginBottom={1}>
          {value.questions.map((item, index) => (
            <Text bold={index === value.current} dimColor={index !== value.current} wrap="truncate-end">
              {`${markOf(value, index)} ${headingOf(item)}`}
            </Text>
          ))}
        </Box>
        <Text bold>{headingOf(question)}</Text>
        {question.body.length > 0 && <Markdown text={question.body} />}
        {question.recommendation !== null && <Markdown dimColor text={`➡️ ${question.recommendation}`} />}
        <Box flexDirection="column" marginTop={1}>
          {previous !== undefined && (
            <Button key="back" plain dimColor label={`◀ ${headingOf(previous)}`} onPress={() => back($)} />
          )}
          <Input
            key="answer"
            value={value.prefill ?? (answer?.kind === 'text' ? answer.text : '')}
            placeholder={placeholder}
            submitLabel="save"
            autoFocus
            onSubmit={text => {
              void submit($, text)
            }}
          />
          <Box flexDirection="row" columnGap={2} flexWrap="wrap">
            <Button key="skip" label="Skip ▶" onPress={() => skip($)} />
            {question.recommendation !== null && (
              <Button key="edit-recommendation" label="Edit recommendation" onPress={() => useRecommendation($)} />
            )}
            <Button key="send" label="Send…" onPress={() => requestSend($)} />
            <Button key="discard" dimColor label="Discard round" onPress={() => requestDiscard($)} />
          </Box>
        </Box>
        <Text dimColor>{`${total - open}/${total} answered · Enter saves · Shift+Tab goes back · Esc closes, /grill reopens`}</Text>
      </Box>
    )
  })
}
