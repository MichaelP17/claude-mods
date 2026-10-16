import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register, RenderElement, RenderSurface } from 'claude-code'

import type { Draft, Question, Round, StoredRound } from '../types'
import type { HubCall, HubEntry } from './hub'
import {
  FORMAT_CONTRACT,
  answerCurrent,
  answerOf,
  choiceAnswerOf,
  choiceOf,
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
  resume,
  roundKeyOf,
  skipCurrent,
} from './rounds'
import { headerCard, noticeCard, previewCard, questionCards, recommendationCards, reviewCard, sendingCard } from './look'
import type { Card, Segment } from './look'

const PANE = 'grill'
const TITLE = 'Grill'
const STORE_PREFIX = 'round:'
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

const round = atom({ plugin: 'grill-panel', key: 'round' } as const, null)
const draft = atom({ plugin: 'grill-panel', key: 'draft' } as const, null)
const isHubbed = atom({ plugin: 'grill-panel', key: 'isHubbed' } as const, false)

let published: string | null = null

// Without mod-hub the call throws, and the mod keeps its own footer count.
async function publish($: EngineInterface, entry: HubEntry): Promise<void> {
  const text = JSON.stringify(entry)
  if (text === published) {
    return
  }
  let isReached = true
  try {
    await ($ as unknown as HubCall).hub.set({ id: 'grill-panel', ...entry })
  } catch {
    isReached = false
  }
  published = isReached ? text : null
  if ((await read($, isHubbed)) !== isReached) {
    await update($, isHubbed, () => isReached)
  }
}

async function report($: EngineInterface): Promise<void> {
  const current = await read($, round)
  const total = current?.questions.length ?? 0
  await publish($, {
    icon: '🔥',
    title: 'Grill',
    status: current === null ? 'No open round' : `${total - openCount(current)} of ${total} answered`,
    attention: current === null ? 'none' : 'info',
    actions: [{ key: 'open', label: current === null ? 'Latest round' : 'Continue' }],
  })
}

type RemoteElements = Pick<ElementTable<'desktop'>, 'Box' | 'Button' | 'Input' | 'Svg' | 'Text'>

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

// One field per question: a field kept across questions keeps the text typed
// into it, since the value it is drawn with stays empty from one to the next.
function fieldOf(value: Round): string {
  return `answer-${value.current}`
}

// Where the desktop's ring starts on a question, so Enter alone takes the
// recommendation unless an answer was typed before.
function startOf(value: Round): string {
  const question = value.questions[value.current]
  if (value.mode === 'review') {
    return 'send'
  }
  if (question === undefined || value.prefill !== null || value.answers[value.current]?.kind === 'text') {
    return fieldOf(value)
  }

  return question.recommendation === null ? fieldOf(value) : 'accept-recommendation'
}

// The terminal keeps its one field, so the ring stays on it there.
async function focusStart($: EngineInterface, value: Round | null, surface: RenderSurface): Promise<void> {
  if (value === null) {
    return
  }
  if (surface === 'terminal') {
    await focus($, value.mode === 'review' ? 'send' : 'answer')
    return
  }
  await focus($, startOf(value))
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
  await report($)
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
  await report($)
  await $.ui.close({ id: PANE })
}

async function openGrill($: EngineInterface): Promise<void> {
  const current = await read($, round)
  if (current === null) {
    const messages = await $.session.messages()
    const questions = latestRoundIn(messages)
    if (questions.length === 0) {
      $.ui.toast('No question round in this conversation.')
      return
    }
    await begin($, questions, true)
  }
  await openPane($)
}

async function finish($: EngineInterface, value: Round): Promise<void> {
  await save($, value, 'done')
  await reset($)
}

async function change($: EngineInterface, apply: (value: Round) => Round): Promise<Round | null> {
  const value = await update($, round, current => (current === null ? null : apply(current)))
  if ((await read($, draft)) !== null) {
    await update($, draft, () => null)
  }
  await report($)

  return value
}

async function submit($: EngineInterface, text: string, surface: RenderSurface): Promise<void> {
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
  await focusStart($, value, surface)
}

async function skip($: EngineInterface, surface: RenderSurface): Promise<void> {
  await focusStart($, await change($, skipCurrent), surface)
}

async function back($: EngineInterface, surface: RenderSurface): Promise<void> {
  await focusStart($, await change($, goBack), surface)
}

async function edit($: EngineInterface, index: number, surface: RenderSurface): Promise<void> {
  await focusStart($, await change($, current => editAt(current, index)), surface)
}

async function useRecommendation($: EngineInterface, surface: RenderSurface): Promise<void> {
  const value = await change($, prefillRecommendation)
  await focusStart($, value, surface)
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

async function cancel($: EngineInterface, surface: RenderSurface): Promise<void> {
  await focusStart($, await change($, resume), surface)
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
  const press = (surface: RenderSurface) => edit($, index, surface)
  if (index === value.current) {
    return <Button key={`goto-${index}`} variant="primary" label={number} onPress={e => press(e.surface)} />
  }
  if (value.answers[index] !== null) {
    return (
      <Button key={`goto-${index}`} dimColor onPress={e => press(e.surface)}>
        <Text color="success">✓</Text>
        {` ${number}`}
      </Button>
    )
  }
  if (value.skipped[index] === true) {
    return (
      <Button key={`goto-${index}`} dimColor onPress={e => press(e.surface)}>
        <Text color="warning">↷</Text>
        {` ${number}`}
      </Button>
    )
  }

  return <Button key={`goto-${index}`} dimColor label={number} onPress={e => press(e.surface)} />
}

// The pane reports its width in columns only; about 8 CSS pixels each, as
// savvy-progress measures it, minus the pane's own inset.
function cardWidthOf(columns: number): number {
  return Math.max(240, Math.min(900, (columns || 40) * 8 - 8))
}

function segmentsOf(value: Round): Segment[] {
  return value.questions.map((_, index) => {
    if (index === value.current && value.mode === 'answer') {
      return 'current'
    }
    if (value.answers[index] !== null) {
      return 'answered'
    }

    return value.skipped[index] === true ? 'skipped' : 'open'
  })
}

function drawCards(ui: RemoteElements, cards: readonly Card[], width: number): RenderElement[] {
  const { Svg } = ui

  return cards.map(card => <Svg source={card.source} alt={card.alt} width={width} height={card.height} />)
}

function drawHeader(ui: RemoteElements, value: Round, width: number, eyebrow: string, title: string): RenderElement {
  const total = value.questions.length
  const card = headerCard({ width, eyebrow, title, counter: `${total - openCount(value)}/${total} answered`, segments: segmentsOf(value) })

  return drawCards(ui, [card], width)[0] as RenderElement
}

// The cards are pictures and take no presses, so every control sits beneath
// the card it belongs to as a native element.
function drawRemote($: EngineInterface, ui: RemoteElements, value: Round, typed: Draft | null, width: number): RenderElement {
  const { Box, Button, Text } = ui
  const total = value.questions.length
  const open = openCount(value)

  if (value.mode === 'sending') {
    return <Box flexDirection="column">{drawCards(ui, [sendingCard(width)], width)}</Box>
  }

  if (value.mode === 'confirm-send') {
    return (
      <Box flexDirection="column" rowGap={1}>
        {drawCards(ui, noticeCard(width, 'card-warning', 'Send with open questions?', `${open} of ${total} questions are unanswered and go out as "(unanswered)".`), width)}
        <Box flexDirection="row" columnGap={1}>
          <Button key="confirm-send" variant="primary" autoFocus label="➤ Send anyway" onPress={() => send($)} />
          <Button key="cancel" label="✎ Keep answering" onPress={e => cancel($, e.surface)} />
        </Box>
      </Box>
    )
  }

  if (value.mode === 'confirm-discard') {
    return (
      <Box flexDirection="column" rowGap={1}>
        {drawCards(ui, noticeCard(width, 'card-error', 'Discard this round?', 'The panel stops offering it; /grill brings it back with its answers.'), width)}
        <Box flexDirection="row" columnGap={1}>
          <Button key="cancel" variant="primary" autoFocus label="Keep round" onPress={e => cancel($, e.surface)} />
          <Button key="confirm-discard" onPress={() => discard($)}>
            <Text color="error">✕ Discard</Text>
          </Button>
        </Box>
      </Box>
    )
  }

  if (value.mode === 'review') {
    return drawRemoteReview($, ui, value, width)
  }

  return drawRemoteQuestion($, ui, value, typed, width)
}

// A choice saved earlier comes back as its letter, so Enter keeps it and the
// preview names it; Enter on an empty field would take the recommendation.
function fieldValueOf(value: Round, question: Question): string {
  const answer = value.answers[value.current] ?? null
  if (value.prefill !== null) {
    return value.prefill
  }
  if (answer?.kind !== 'text') {
    return ''
  }
  const choice = choicesOf(question.body).options.find(i => choiceAnswerOf(i) === answer.text)

  return choice?.letter ?? answer.text
}

function drawRemoteQuestion($: EngineInterface, ui: RemoteElements, value: Round, typed: Draft | null, width: number): RenderElement {
  const { Box, Button, Input, Text } = ui
  const question = value.questions[value.current]
  if (question === undefined) {
    return <Text dimColor>No open question round. /grill brings back the latest one.</Text>
  }
  const total = value.questions.length
  const answer = value.answers[value.current] ?? null
  const hasChoices = choicesOf(question.body).options.length > 0
  const start = startOf(value)
  const field = fieldOf(value)
  const fieldValue = fieldValueOf(value, question)
  const shown = typed?.field === field ? typed.text : fieldValue
  const typedChoice = choiceOf(shown, question)
  // The desktop's field is a single line, so a longer answer scrolls out of
  // sight; the card beneath it shows the whole of what Enter will save.
  const preview = shown.trim().length > 0 ? previewCard(width, shown.trim(), typedChoice) : []

  return (
    <Box flexDirection="column" rowGap={1}>
      {drawHeader(ui, value, width, `QUESTION ${value.current + 1} OF ${total}`, question.title.length > 0 ? question.title : `Question ${question.number}`)}
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        {value.questions.map((_, index) => drawStep($, ui, value, index))}
      </Box>
      {drawCards(ui, questionCards(width, question, answer), width)}
      {question.recommendation !== null && (
        <Box flexDirection="column" rowGap={1}>
          {drawCards(ui, recommendationCards(width, question.recommendation, answer?.kind === 'recommendation'), width)}
          <Box flexDirection="row" columnGap={1} flexWrap="wrap">
            <Button
              key="accept-recommendation"
              variant="primary"
              {...(start === 'accept-recommendation' ? { autoFocus: true as const } : {})}
              label={answer?.kind === 'recommendation' ? '✓ Accepted' : '✓ Accept recommendation'}
              onPress={e => submit($, '', e.surface)}
            />
            <Button key="edit-recommendation" label="✎ Edit before saving" onPress={e => useRecommendation($, e.surface)} />
          </Box>
        </Box>
      )}
      <Box flexDirection="column" alignItems="stretch" rowGap={0}>
        <Text bold dimColor>
          {hasChoices ? 'YOUR ANSWER · A LETTER OR YOUR OWN WORDS' : 'YOUR ANSWER'}
        </Text>
        <Input
          key={field}
          value={fieldValue}
          placeholder={hasChoices ? 'A letter, or your own answer · Enter saves' : 'Your answer · Enter saves'}
          submitLabel="Save"
          {...(start === field ? { autoFocus: true as const } : {})}
          onInput={text => {
            void update($, draft, () => ({ field, text }))
          }}
          onSubmit={(text, e) => {
            void submit($, text, e.surface)
          }}
        />
      </Box>
      {drawCards(ui, preview, width)}
      <Box flexDirection="row" justifyContent="space-between" flexWrap="wrap" columnGap={1}>
        <Button key="skip" dimColor label="↷ Skip for now" onPress={e => skip($, e.surface)} />
        <Box flexDirection="row" columnGap={1}>
          <Button key="send" dimColor label="➤ Send now…" onPress={() => requestSend($)} />
          <Button key="discard" dimColor hover={DISCARD_HOVER} label="✕ Discard" onPress={() => requestDiscard($)} />
        </Box>
      </Box>
    </Box>
  )
}

function drawRemoteReview($: EngineInterface, ui: RemoteElements, value: Round, width: number): RenderElement {
  const { Box, Button, Text } = ui
  const total = value.questions.length
  const open = openCount(value)

  return (
    <Box flexDirection="column" rowGap={1}>
      {drawHeader(ui, value, width, 'REVIEW', open === 0 ? 'All questions answered' : `${open} of ${total} unanswered`)}
      <Box flexDirection="row" columnGap={1} flexWrap="wrap" alignItems="center">
        <Text bold dimColor>
          EDIT
        </Text>
        {value.questions.map((_, index) => (
          <Button key={`edit-${index}`} dimColor label={`✎ ${index + 1}`} onPress={e => edit($, index, e.surface)} />
        ))}
      </Box>
      {drawCards(
        ui,
        value.questions.map((question, index) => reviewCard(width, index, question, value.answers[index] ?? null)),
        width,
      )}
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
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
    await report($)

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
    await openGrill($)

    return {}
  })

  on('ui.press', { plugin: 'mod-hub', element: 'grill-panel:open' }, async ($, e, next) => {
    await openGrill($)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const value = await read($, round)
    if (e.surface === 'mobile') {
      const { Text } = $.ui.resolve(e)

      return <Text dimColor>This app draws no text field; answer this round in the terminal or the desktop app.</Text>
    }
    if (e.surface !== 'terminal') {
      const remote = $.ui.resolve(e)
      if (value === null) {
        return <remote.Text dimColor>No open question round. /grill brings back the latest one.</remote.Text>
      }

      return drawRemote($, remote, value, await read($, draft), cardWidthOf(e.props.bodyColumns))
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
            <Button key="cancel" label="Keep answering" onPress={e => cancel($, e.surface)} />
          </Box>
        </Box>
      )
    }

    if (value.mode === 'confirm-discard') {
      return (
        <Box flexDirection="column">
          <Text>Discard this round? The panel stops offering it; /grill brings it back with its answers.</Text>
          <Box flexDirection="row" columnGap={2} marginTop={1}>
            <Button key="cancel" autoFocus label="Keep round" onPress={e => cancel($, e.surface)} />
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
              onPress={e => edit($, index, e.surface)}
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
            <Button key="back" plain dimColor label={`◀ ${headingOf(previous)}`} onPress={e => back($, e.surface)} />
          )}
          <Input
            key="answer"
            value={value.prefill ?? (answer?.kind === 'text' ? answer.text : '')}
            placeholder={placeholder}
            submitLabel="save"
            autoFocus
            onSubmit={(text, e) => {
              void submit($, text, e.surface)
            }}
          />
          <Box flexDirection="row" columnGap={2} flexWrap="wrap">
            <Button key="skip" label="Skip ▶" onPress={e => skip($, e.surface)} />
            {question.recommendation !== null && (
              <Button key="edit-recommendation" label="Edit recommendation" onPress={e => useRecommendation($, e.surface)} />
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
    if (await read($, isHubbed)) {
      return next(e)
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
