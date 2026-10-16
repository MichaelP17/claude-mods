import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register, RenderElement, RenderSurface } from 'claude-code'

import type { Draft, Question, Round, StoredRound } from '../types'
import type { HubCall, HubEntry } from './hub'
import {
  FORMAT_CONTRACT,
  answerCurrent,
  answerOf,
  choiceAnswerOf,
  choicePartsOf,
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
import type { Choice } from './rounds'
import { ringSvg } from './look'

const PANE = 'grill'
const TITLE = 'Grill'
const STORE_PREFIX = 'round:'
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

// The desktop's field is a single line, so a longer answer scrolls out of
// sight; from this length on it is shown wrapped beneath the field.
const PREVIEW_LENGTH = 50

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

type RemoteElements = Pick<ElementTable<'desktop'>, 'Box' | 'Button' | 'Input' | 'Markdown' | 'Svg' | 'Text'>

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

function chosenOf(value: Round, options: readonly Choice[]): number {
  const answer = value.answers[value.current] ?? null

  return answer?.kind === 'text' ? options.findIndex(i => choiceAnswerOf(i) === answer.text) : -1
}

function recommendedOf(question: Question, options: readonly Choice[]): number {
  const letter = recommendedLetterOf(question.recommendation)

  return options.findIndex(i => i.letter === letter)
}

// Where the desktop's ring starts on a question, so Enter alone takes what the
// panel suggests: the answer given before, else the recommendation.
function startOf(value: Round): string {
  const question = value.questions[value.current]
  if (value.mode === 'review') {
    return 'send'
  }
  if (question === undefined || value.prefill !== null) {
    return fieldOf(value)
  }
  const { options } = choicesOf(question.body)
  const chosen = chosenOf(value, options)
  if (chosen !== -1) {
    return `choice-${chosen}`
  }
  if (value.answers[value.current]?.kind === 'text') {
    return fieldOf(value)
  }
  const recommended = recommendedOf(question, options)
  if (recommended !== -1) {
    return `choice-${recommended}`
  }
  if (question.recommendation !== null) {
    return 'accept-recommendation'
  }

  return options.length > 0 ? 'choice-0' : fieldOf(value)
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

function drawHeader(ui: RemoteElements, eyebrow: string, title: string, done: number, total: number): RenderElement {
  const { Box, Svg, Text } = ui

  return (
    <Box flexDirection="row" columnGap={2} alignItems="center">
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Text bold color="claude">
          {eyebrow}
        </Text>
        <Text bold>{title}</Text>
      </Box>
      <Svg source={ringSvg(done, total)} alt={`${done} of ${total} answered`} width={44} height={44} />
    </Box>
  )
}

// A Button holds strings and Text only, so the parts are gathered without the
// `false` a conditional in JSX would leave among them. On the filled primary
// button an accent color would vanish, so its parts keep the button's own.
function drawChoice($: EngineInterface, ui: RemoteElements, choice: Choice, index: number, state: { isRecommended: boolean; isChosen: boolean; isPrimary: boolean; isStart: boolean }): RenderElement {
  const { Box, Button, Text } = ui
  const { head, rest } = choicePartsOf(choice)
  const tone = (color: 'success' | 'claude') => (state.isPrimary ? {} : { color })
  const parts: (string | RenderElement)[] = [
    <Text bold {...tone(state.isChosen ? 'success' : 'claude')}>{`${choice.letter.toUpperCase()}   `}</Text>,
    head.length > 0 ? <Text bold>{head}</Text> : rest,
  ]
  if (state.isChosen) {
    parts.push(<Text {...tone('success')}>{'   ✓ Chosen'}</Text>)
  } else if (state.isRecommended) {
    parts.push(<Text {...tone('claude')}>{'   ★ Recommended'}</Text>)
  }

  return (
    <Box key={`choice-row-${index}`} flexDirection="column" alignItems="stretch" rowGap={0}>
      <Button
        key={`choice-${index}`}
        {...(state.isPrimary ? { variant: 'primary' as const } : {})}
        {...(state.isStart ? { autoFocus: true as const } : {})}
        onPress={e => submit($, choiceAnswerOf(choice), e.surface)}
      >
        {parts}
      </Button>
      {head.length > 0 && rest.length > 0 && (
        <Box paddingX={2}>
          <Text dimColor>{rest}</Text>
        </Box>
      )}
    </Box>
  )
}

// The desktop and the editor draw native controls and borders, so the terminal's
// glyph lists and key hints give way to steps, cards and buttons there.
function drawRemote($: EngineInterface, ui: RemoteElements, value: Round, typed: Draft | null): RenderElement {
  const { Box, Button, Text } = ui
  const total = value.questions.length
  const open = openCount(value)

  if (value.mode === 'sending') {
    return <Text dimColor>Sending… Claude gets the answers as soon as it is free.</Text>
  }

  if (value.mode === 'confirm-send') {
    return (
      <Box flexDirection="column" rowGap={1} borderStyle="round" borderColor="warning" paddingX={2}>
        <Text bold>Send with open questions?</Text>
        <Text>{`${open} of ${total} questions are unanswered and go out as "(unanswered)".`}</Text>
        <Box flexDirection="row" columnGap={1}>
          <Button key="confirm-send" variant="primary" autoFocus label="➤ Send anyway" onPress={() => send($)} />
          <Button key="cancel" label="✎ Keep answering" onPress={e => cancel($, e.surface)} />
        </Box>
      </Box>
    )
  }

  if (value.mode === 'confirm-discard') {
    return (
      <Box flexDirection="column" rowGap={1} borderStyle="round" borderColor="error" paddingX={2}>
        <Text bold>Discard this round?</Text>
        <Text>The panel stops offering it; /grill brings it back with its answers.</Text>
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
    return drawRemoteReview($, ui, value)
  }

  return drawRemoteQuestion($, ui, value, typed)
}

function drawRemoteQuestion($: EngineInterface, ui: RemoteElements, value: Round, typed: Draft | null): RenderElement {
  const { Box, Button, Input, Markdown, Text } = ui
  const question = value.questions[value.current]
  if (question === undefined) {
    return <Text dimColor>No open question round. /grill brings back the latest one.</Text>
  }
  const total = value.questions.length
  const answer = value.answers[value.current] ?? null
  const choices = choicesOf(question.body)
  const recommended = recommendedOf(question, choices.options)
  const chosen = chosenOf(value, choices.options)
  const start = startOf(value)
  const field = fieldOf(value)
  const fieldValue = value.prefill ?? (answer?.kind === 'text' && chosen === -1 ? answer.text : '')
  const shown = typed?.field === field ? typed.text : fieldValue

  return (
    <Box flexDirection="column" rowGap={1}>
      {drawHeader(
        ui,
        `QUESTION ${value.current + 1} OF ${total}`,
        question.title.length > 0 ? question.title : `Question ${question.number}`,
        total - openCount(value),
        total,
      )}
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        {value.questions.map((_, index) => drawStep($, ui, value, index))}
      </Box>
      {choices.lead.length > 0 && <Markdown text={choices.lead} />}
      {choices.options.length > 0 && (
        <Box flexDirection="column" rowGap={1}>
          {choices.options.map((choice, index) =>
            drawChoice($, ui, choice, index, {
              isRecommended: index === recommended,
              isChosen: index === chosen,
              isPrimary: index === (chosen === -1 ? recommended : chosen),
              isStart: start === `choice-${index}`,
            }),
          )}
        </Box>
      )}
      {choices.trail.length > 0 && <Markdown text={choices.trail} />}
      {question.recommendation !== null && (
        <Box key="recommendation" flexDirection="column" rowGap={0} borderStyle="round" borderColor="claude" paddingX={2}>
          <Text bold color="claude">
            ★ RECOMMENDATION
          </Text>
          <Markdown text={question.recommendation} />
          <Box flexDirection="row" columnGap={1} flexWrap="wrap">
            {recommended === -1 && (
              <Button
                key="accept-recommendation"
                variant="primary"
                {...(start === 'accept-recommendation' ? { autoFocus: true as const } : {})}
                label={answer?.kind === 'recommendation' ? '✓ Accepted' : '✓ Accept'}
                onPress={e => submit($, '', e.surface)}
              />
            )}
            <Button key="edit-recommendation" label="✎ Edit before saving" onPress={e => useRecommendation($, e.surface)} />
          </Box>
        </Box>
      )}
      <Box flexDirection="column" alignItems="stretch" rowGap={0}>
        <Text bold dimColor>
          {choices.options.length > 0 ? 'OR YOUR OWN ANSWER' : 'YOUR ANSWER'}
        </Text>
        <Input
          key={field}
          value={fieldValue}
          placeholder="Type your answer, Enter saves it"
          submitLabel="Save"
          {...(start === field ? { autoFocus: true as const } : {})}
          onInput={text => {
            void update($, draft, () => ({ field, text }))
          }}
          onSubmit={(text, e) => {
            void submit($, text, e.surface)
          }}
        />
        {shown.length > PREVIEW_LENGTH && (
          <Box key="preview" flexDirection="column" borderStyle="round" borderDimColor paddingX={2}>
            <Text>{shown}</Text>
          </Box>
        )}
      </Box>
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

function drawRemoteReview($: EngineInterface, ui: RemoteElements, value: Round): RenderElement {
  const { Box, Button, Text } = ui
  const total = value.questions.length
  const open = openCount(value)

  return (
    <Box flexDirection="column" rowGap={1}>
      {drawHeader(ui, 'REVIEW', open === 0 ? 'All questions answered' : `${open} of ${total} unanswered`, total - open, total)}
      <Text dimColor>Check the answers, then send them to Claude in one message.</Text>
      <Box flexDirection="column" rowGap={1}>
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
              paddingX={2}
            >
              <Box flexDirection="column" flexGrow={1} flexShrink={1} rowGap={0}>
                <Text bold dimColor>
                  {question.title.length > 0 ? `${index + 1} · ${question.title}` : `Question ${index + 1}`}
                </Text>
                {answer === null ? (
                  <Text color="warning">Unanswered</Text>
                ) : answer.kind === 'recommendation' ? (
                  <Text color="claude">★ Recommendation accepted</Text>
                ) : (
                  <Text>{answer.text}</Text>
                )}
              </Box>
              <Button key={`edit-${index}`} dimColor hover={{ dimColor: false, color: 'claude' }} label="✎ Edit" onPress={e => edit($, index, e.surface)} />
            </Box>
          )
        })}
      </Box>
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

      return drawRemote($, remote, value, await read($, draft))
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
