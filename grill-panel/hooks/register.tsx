import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register, RenderElement } from 'claude-code'

import type { Question, Round, StoredRound } from '../types'
import {
  FORMAT_CONTRACT,
  answerCurrent,
  answerOf,
  choiceAnswerOf,
  choicesOf,
  editAt,
  footerOf,
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
  recommendedLetterOf,
  resume,
  roundKeyOf,
  skipCurrent,
} from './rounds'

const PANE = 'grill'
const TITLE = 'Grill'
const STORE_PREFIX = 'round:'
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

const round = atom({ plugin: 'grill-panel', key: 'round' } as const, null)

type RemoteElements = Pick<ElementTable<'desktop'>, 'Box' | 'Button' | 'Input' | 'Markdown' | 'Text'>

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

// Unasked, a narrow terminal leaves the pane undrawn, and the count in the
// footer alone does not say how to open it.
async function openPane($: EngineInterface): Promise<void> {
  const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })
  if (!opened.isPlaced) {
    $.ui.toast('Question round ready · /grill opens it', { timeoutMs: 10_000 })
  }
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
  await $.ui.close({ id: PANE })
}

async function finish($: EngineInterface, value: Round): Promise<void> {
  await save($, value, 'done')
  await reset($)
}

async function change($: EngineInterface, apply: (value: Round) => Round): Promise<Round | null> {
  return update($, round, current => (current === null ? null : apply(current)))
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

// Both discard buttons share the scope; only one of them is ever drawn.
const DISCARD_HOVER = { scope: 'discard', color: 'error', dimColor: false } as const

function drawStep($: EngineInterface, ui: RemoteElements, value: Round, index: number): RenderElement {
  const { Button, Text } = ui
  const number = String(index + 1)
  const press = () => edit($, index)
  if (index === value.current) {
    return <Button key={`goto-${index}`} variant="primary" label={number} onPress={press} />
  }
  if (value.answers[index] !== null) {
    return (
      <Button key={`goto-${index}`} onPress={press}>
        <Text color="success">✓</Text>
        {` ${number}`}
      </Button>
    )
  }
  if (value.skipped[index] === true) {
    return (
      <Button key={`goto-${index}`} onPress={press}>
        <Text color="warning">↷</Text>
        {` ${number}`}
      </Button>
    )
  }

  return <Button key={`goto-${index}`} label={number} onPress={press} />
}

// The desktop and the editor draw native controls and borders, so the terminal's
// glyph lists and key hints give way to steps, cards and buttons there.
function drawRemote($: EngineInterface, ui: RemoteElements, value: Round): RenderElement {
  const { Box, Button, Text } = ui
  const total = value.questions.length
  const open = openCount(value)

  if (value.mode === 'sending') {
    return <Text dimColor>Sending… Claude gets the answers as soon as it is free.</Text>
  }

  if (value.mode === 'confirm-send') {
    return (
      <Box flexDirection="column" rowGap={1} borderStyle="round" borderColor="warning" paddingX={1}>
        <Text bold>Send with open questions?</Text>
        <Text>{`${open} of ${total} questions are unanswered and go out as "(unanswered)".`}</Text>
        <Box flexDirection="row" columnGap={1}>
          <Button key="confirm-send" variant="primary" autoFocus label="➤ Send anyway" onPress={() => send($)} />
          <Button key="cancel" label="✎ Keep answering" onPress={() => cancel($)} />
        </Box>
      </Box>
    )
  }

  if (value.mode === 'confirm-discard') {
    return (
      <Box flexDirection="column" rowGap={1} borderStyle="round" borderColor="error" paddingX={1}>
        <Text bold>Discard this round?</Text>
        <Text>The panel stops offering it; /grill brings it back with its answers.</Text>
        <Box flexDirection="row" columnGap={1}>
          <Button key="cancel" variant="primary" autoFocus label="Keep round" onPress={() => cancel($)} />
          <Button key="confirm-discard" onPress={() => discard($)}>
            <Text color="error">✕ Discard</Text>
          </Button>
        </Box>
      </Box>
    )
  }

  if (value.mode === 'review') {
    return drawRemoteReview($, ui, value)
  }

  return drawRemoteQuestion($, ui, value)
}

function drawRemoteQuestion($: EngineInterface, ui: RemoteElements, value: Round): RenderElement {
  const { Box, Button, Input, Markdown, Text } = ui
  const question = value.questions[value.current]
  if (question === undefined) {
    return <Text dimColor>No open question round. /grill brings back the latest one.</Text>
  }
  const total = value.questions.length
  const answer = value.answers[value.current] ?? null
  const choices = choicesOf(question.body)
  const recommended = recommendedLetterOf(question.recommendation)

  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text dimColor>{`Question ${value.current + 1} of ${total}`}</Text>
        <Text dimColor>{`${total - openCount(value)} answered`}</Text>
      </Box>
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        {value.questions.map((_, index) => drawStep($, ui, value, index))}
      </Box>
      <Text bold>{question.title.length > 0 ? question.title : `Question ${question.number}`}</Text>
      {choices.lead.length > 0 && <Markdown text={choices.lead} />}
      {choices.options.length > 0 && (
        <Box flexDirection="column" rowGap={1}>
          {choices.options.map((choice, index) => (
            <Box key={`choice-row-${index}`} flexDirection="row" columnGap={1} alignItems="flex-start">
              <Button
                key={`choice-${index}`}
                label={choice.letter.toUpperCase()}
                {...(choice.letter === recommended ? { variant: 'primary' as const } : {})}
                onPress={() => submit($, choiceAnswerOf(choice))}
              />
              <Box flexDirection="column" flexShrink={1}>
                <Text hover={{ color: 'claude' }}>{choice.text}</Text>
                {choice.letter === recommended && <Text color="claude">★ Recommended</Text>}
              </Box>
            </Box>
          ))}
        </Box>
      )}
      {question.recommendation !== null && (
        <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
          <Text bold color="claude">
            Recommendation
          </Text>
          <Markdown text={question.recommendation} />
          <Box flexDirection="row" columnGap={1} marginTop={1}>
            <Button key="accept-recommendation" onPress={() => submit($, '')}>
              <Text color="success">✓</Text>
              {answer?.kind === 'recommendation' ? ' Accepted' : ' Accept'}
            </Button>
            <Button key="edit-recommendation" label="✎ Edit before saving" onPress={() => useRecommendation($)} />
          </Box>
        </Box>
      )}
      <Box flexDirection="column" alignItems="stretch">
        <Input
          key="answer"
          value={value.prefill ?? (answer?.kind === 'text' ? answer.text : '')}
          placeholder={choices.options.length > 0 ? 'Or your own answer' : 'Your answer'}
          submitLabel="Save"
          autoFocus
          onSubmit={text => {
            void submit($, text)
          }}
        />
      </Box>
      <Box flexDirection="row" justifyContent="space-between" flexWrap="wrap" columnGap={1}>
        <Button key="skip" label="↷ Skip for now" onPress={() => skip($)} />
        <Box flexDirection="row" columnGap={1}>
          <Button key="send" dimColor label="➤ Send now…" onPress={() => requestSend($)} />
          <Button key="discard" dimColor hover={DISCARD_HOVER} label="✕ Discard" onPress={() => requestDiscard($)} />
        </Box>
      </Box>
    </Box>
  )
}

function drawRemoteReview($: EngineInterface, ui: RemoteElements, value: Round): RenderElement {
  const { Box, Button, Text } = ui
  const total = value.questions.length
  const open = openCount(value)

  return (
    <Box flexDirection="column" rowGap={1}>
      <Text bold>{open === 0 ? 'All questions answered' : `${open} of ${total} unanswered`}</Text>
      <Text dimColor>Check the answers, then send them to Claude in one message.</Text>
      {value.questions.map((question, index) => {
        const answer = value.answers[index] ?? null

        return (
          <Box
            key={`card-${index}`}
            flexDirection="row"
            columnGap={1}
            alignItems="center"
            borderStyle="round"
            {...(answer === null ? { borderColor: 'warning' } : { borderDimColor: true })}
            hover={{ borderColor: 'claude', borderDimColor: false }}
            paddingX={1}
          >
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              <Text dimColor>{question.title.length > 0 ? `${index + 1} · ${question.title}` : `Question ${index + 1}`}</Text>
              {answer === null ? (
                <Text color="warning">Unanswered</Text>
              ) : answer.kind === 'recommendation' ? (
                <Text color="claude">★ Recommendation accepted</Text>
              ) : (
                <Text>{answer.text}</Text>
              )}
            </Box>
            <Button key={`edit-${index}`} dimColor hover={{ dimColor: false, color: 'claude' }} label="✎ Edit" onPress={() => edit($, index)} />
          </Box>
        )
      })}
      <Box flexDirection="row" justifyContent="space-between">
        <Button key="send" variant="primary" autoFocus label="➤ Send to Claude" onPress={() => requestSend($)} />
        <Button key="discard" dimColor hover={DISCARD_HOVER} label="✕ Discard round" onPress={() => requestDiscard($)} />
      </Box>
    </Box>
  )
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
    const elements = $.ui.resolve(e)
    const { Box, Button, Input, Markdown, Text } = elements
    if (value === null) {
      return <Text dimColor>No open question round. /grill brings back the latest one.</Text>
    }
    if (e.surface !== 'terminal') {
      return drawRemote($, elements, value)
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

  // The terminal draws the mode labels itself, so the label joins them there.
  // On the desktop, status-band draws the footer from the labels it was handed,
  // whichever order the mods load in; only a drawn tree survives that.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const current = await read($, round)
    if (current === null) {
      return next(e)
    }
    const label = footerOf(current)
    if (e.surface === 'terminal') {
      return next({ ...e, props: { ...e.props, modes: [...e.props.modes, label] } })
    }
    const below = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const rest = below.type !== 'engine' ? below : e.props.modes.length === 0 ? null : <Text dimColor>{e.props.modes.join(' & ')}</Text>

    return (
      <Box flexDirection="row">
        <Text dimColor>{label}</Text>
        {rest !== null && <Text dimColor> · </Text>}
        {rest}
      </Box>
    )
  })
}
