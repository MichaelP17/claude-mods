import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register, RenderElement } from 'claude-code'

import type { HubCall, HubEntry } from './hub'
import { formatIdeas, ideasFileOf, normalizeIdea, numberedList, parseIdeas, previewOf } from './ideas'
import { buttonWidthOf, headerCard, ideaCards } from './look'
import { ROOMY_WIDTH, cardWidthOf, columnsOf, fieldCard } from './svg'

const CAPTURE_PANE = 'idea'
const LIST_PANE = 'ideas'
const LIST_TOOL = 'mcp__idea-shell__ideas_list'
const REMOVE_TOOL = 'mcp__idea-shell__idea_remove'

const ideas = atom({ plugin: 'idea-shell', key: 'ideas' } as const, [])
const isHubbed = atom({ plugin: 'idea-shell', key: 'isHubbed' } as const, false)

let published: string | null = null

// Without mod-hub the call throws, and the mod keeps its own footer bulb.
async function publish($: EngineInterface, entry: HubEntry): Promise<void> {
  const text = JSON.stringify(entry)
  if (text === published) {
    return
  }
  let isReached = true
  try {
    await ($ as unknown as HubCall).hub.set({ id: 'idea-shell', ...entry })
  } catch {
    isReached = false
  }
  published = isReached ? text : null
  if ((await read($, isHubbed)) !== isReached) {
    await update($, isHubbed, () => isReached)
  }
}

async function ideasFile($: EngineInterface): Promise<string> {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  const configDirectory = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
  const folder = await $.session.root()

  return ideasFileOf(folder, home, `${configDirectory}/ideas`)
}

// Every change starts from the file, not from the drawn list, so ideas another
// session or Claude added in the meantime are never overwritten.
async function load($: EngineInterface): Promise<string[]> {
  const path = await ideasFile($)
  const text = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
  const list = parseIdeas(text)
  await update($, ideas, () => list)
  await report($, list)

  return list
}

async function save($: EngineInterface, list: string[]): Promise<void> {
  const path = await ideasFile($)
  if (list.length > 0) {
    await $.fs.write(path, formatIdeas(list))
  } else if (await $.fs.exists(path)) {
    await $.process.run(['rm', '-f', path])
  }
  await update($, ideas, () => list)
  await report($, list)
}

async function report($: EngineInterface, list: readonly string[]): Promise<void> {
  await publish($, {
    icon: '💡',
    title: 'Ideas',
    status: list.length === 0 ? 'None for this folder' : `${list.length} for this folder`,
    attention: 'none',
    actions: [{ key: 'open', label: 'Open' }],
  })
}

async function addIdea($: EngineInterface, text: string): Promise<boolean> {
  const idea = normalizeIdea(text)
  if (idea.length === 0) {
    return false
  }
  const list = await load($)
  await save($, [...list, idea])

  return true
}

async function removeIdea($: EngineInterface, idea: string): Promise<boolean> {
  const list = await load($)
  const index = list.indexOf(idea)
  if (index === -1) {
    return false
  }
  await save($, list.filter((_, position) => position !== index))

  return true
}

async function workOn($: EngineInterface, idea: string): Promise<void> {
  const draft = await $.prompt.read()
  const isEmpty = draft.text.trim().length === 0
  const filled = await $.prompt.fill({ text: isEmpty ? idea : `\n${idea}`, mode: isEmpty ? 'replace' : 'append' })
  if (!filled.isFilled) {
    $.ui.toast('The prompt box is busy; the idea stays in the list.')
    return
  }
  await removeIdea($, idea)
  await $.ui.close({ id: LIST_PANE })
  if (await isDrawnRemotely($)) {
    await $.ui.close({ id: CAPTURE_PANE })
  }
}

// The desktop app and the editor draw one Ideas pane, the field above the list;
// the terminal keeps the inline capture field apart from the list.
async function isDrawnRemotely($: EngineInterface): Promise<boolean> {
  const surfaces = await $.session.surfaces()

  return surfaces.some(i => i !== 'terminal')
}

async function openCapture($: EngineInterface): Promise<void> {
  await load($)
  const isRemote = await isDrawnRemotely($)
  await $.ui.open({ id: CAPTURE_PANE, title: isRemote ? 'Ideas' : 'New idea', focus: true, closeOnEscape: true, rows: 4 })
}

async function openList($: EngineInterface): Promise<void> {
  if (await isDrawnRemotely($)) {
    await openCapture($)
    return
  }
  await load($)
  await $.ui.open({ id: LIST_PANE, title: 'Ideas', focus: true, closeOnEscape: true })
}

type IdeasElements = Pick<ElementTable<'desktop'>, 'Box' | 'Button' | 'Svg' | 'Text'> & { Input: ElementTable<'desktop'>['Input'] | null }

const IDEA_LABELS = ['➤ Work on it', '✕']

const FIELD_LABEL_WIDTH = 176

const FIELD_HINT = 'Enter saves it here · Claude sees an idea only once you hand it over'

// The field and the buttons lie over the cards, centered on their height: the
// pictures take no presses. A narrow pane keeps the field beneath its label.
function drawIdeas($: EngineInterface, ui: IdeasElements, list: readonly string[], folder: string, width: number): RenderElement {
  const { Box, Button, Input, Svg, Text } = ui
  const header = headerCard({ width, eyebrow: '💡 IDEAS', title: list.length === 0 ? 'Nothing waiting' : `${list.length} waiting`, counter: folder })
  const field = fieldCard(width, 'NEW IDEA', FIELD_HINT, FIELD_LABEL_WIDTH)
  const drawInput = (Field: ElementTable<'desktop'>['Input']) => (
    <Field
      key="idea"
      value=""
      placeholder="Capture a new idea…"
      submitLabel="Save"
      autoFocus
      onSubmit={value => {
        void addIdea($, value)
      }}
    />
  )

  return (
    <Box flexDirection="column" rowGap={1}>
      <Svg source={header.source} alt={header.alt} width={width} height={header.height} />
      {Input !== null &&
        (width >= ROOMY_WIDTH ? (
          <Box key="new-idea" flexDirection="column">
            <Svg source={field.source} alt={field.alt} width={width} height={field.height} />
            <Box position="absolute" top={0} bottom={0} left={columnsOf(FIELD_LABEL_WIDTH)} right={2} flexDirection="column" justifyContent="center">
              {drawInput(Input)}
            </Box>
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text bold dimColor>
              NEW IDEA
            </Text>
            {drawInput(Input)}
            <Text dimColor>{FIELD_HINT}</Text>
          </Box>
        ))}
      {list.length === 0 ? (
        <Text dimColor>No ideas yet. The next one that crosses your mind goes in the field above.</Text>
      ) : (
        <Box flexDirection="column" rowGap={1}>
          <Text dimColor bold>
            WAITING
          </Text>
          {list.map((idea, index) => (
            <Box key={`card-${index}`} flexDirection="column">
              {ideaCards(width, idea, index, buttonWidthOf(IDEA_LABELS)).map(card => (
                <Svg source={card.source} alt={card.alt} width={width} height={card.height} />
              ))}
              <Box position="absolute" top={0} bottom={0} right={2} flexDirection="row" alignItems="center" columnGap={1}>
                <Button key={`work-${index}`} label={IDEA_LABELS[0]} onPress={() => workOn($, idea)} />
                <Button key={`delete-${index}`} dimColor label={IDEA_LABELS[1]} onPress={() => removeIdea($, idea)} />
              </Box>
            </Box>
          ))}
          <Text dimColor>Work on it moves the idea into the prompt box and off this list.</Text>
        </Box>
      )}
    </Box>
  )
}

function folderNameOf(root: string): string {
  return root.split('/').filter(i => i.length > 0).at(-1) ?? root
}

function textResult(text: string) {
  return { result: text }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'idea',
      description: 'Capture an idea for this folder without interrupting Claude',
      argumentHint: '[idea]',
      immediate: true,
    })
    await $.command.register({
      name: 'ideas',
      description: 'Show the ideas captured for this folder and hand one to Claude',
      immediate: true,
    })
    await $.tool.register({
      name: 'ideas_list',
      description:
        'Lists the ideas the user captured with /idea for the folder this session runs in, numbered. Use it when the user asks to work through, review or pick from their ideas.',
      inputSchema: { type: 'object', properties: {} },
    })
    await $.tool.register({
      name: 'idea_remove',
      description:
        'Removes one idea from this folder\'s list. Call it only once the idea is done or the user dropped it. `number` comes from the latest ideas_list; list again before removing another, since the numbers shift.',
      inputSchema: {
        type: 'object',
        properties: { number: { type: 'integer', minimum: 1 } },
        required: ['number'],
      },
    })
    await load($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await load($)

    return result
  })

  on('command.run', { command: 'idea' }, async ($, e) => {
    if (e.args.trim().length > 0) {
      if (await addIdea($, e.args)) {
        $.ui.toast('Idea saved')
      }

      return {}
    }
    await openCapture($)

    return {}
  })

  on('command.run', { command: 'ideas' }, async $ => {
    await openList($)

    return {}
  })

  on('ui.press', { plugin: 'mod-hub', element: 'idea-shell:open' }, async ($, e, next) => {
    const list = await load($)
    await (list.length === 0 ? openCapture($) : openList($))

    return next(e)
  })

  on('tool.call', { tool: LIST_TOOL }, async $ => {
    const list = await load($)

    return textResult(list.length === 0 ? 'No ideas captured for this folder.' : numberedList(list))
  }).catch(() => ({ deny: 'idea-shell could not read the ideas file.' }))

  on('tool.call', { tool: REMOVE_TOOL }, async ($, e) => {
    const number = (e as { number?: unknown }).number
    const list = await load($)
    const idea = typeof number === 'number' ? list[number - 1] : undefined
    if (idea === undefined) {
      return textResult(`No idea number ${String(number)}; the list has ${list.length}.`)
    }
    await removeIdea($, idea)

    return textResult(`Removed: ${idea}`)
  }).catch(() => ({ deny: 'idea-shell could not update the ideas file.' }))

  on('ui.render', { component: 'Pane', requestId: CAPTURE_PANE }, async ($, e) => {
    // Asked by surface, not by `'Input' in` the table: the mobile table carries an
    // Input that draws nothing.
    if (e.surface === 'mobile') {
      const { Text } = $.ui.resolve(e)

      return <Text dimColor>This app draws no text field. /idea followed by the idea saves it.</Text>
    }
    if (e.surface !== 'terminal') {
      const { Box, Button, Input, Svg, Text } = $.ui.resolve(e)

      // Reading the list makes every save redraw the pane, which empties the field.
      return drawIdeas($, { Box, Button, Input, Svg, Text }, await read($, ideas), folderNameOf(await $.session.root()), cardWidthOf(e.props.bodyColumns))
    }
    // Reading the list makes every save redraw the pane, which empties the field.
    const count = (await read($, ideas)).length
    const { Box, Input, Text } = $.ui.resolve(e)
    const hint = `${count} ${count === 1 ? 'idea' : 'ideas'} for this folder · Shift+Enter adds a line · Esc closes`

    return (
      <Box flexDirection="column">
        <Input
          key="idea"
          value=""
          placeholder="New idea"
          submitLabel="save"
          autoFocus
          onSubmit={value => {
            void addIdea($, value)
          }}
        />
        <Text dimColor>{hint}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: LIST_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, ideas)
    if (e.surface !== 'terminal') {
      const { Svg } = $.ui.resolve(e)

      return drawIdeas($, { Box, Button, Input: null, Svg, Text }, list, folderNameOf(await $.session.root()), cardWidthOf(e.props.bodyColumns))
    }
    if (list.length === 0) {
      return <Text dimColor>No ideas for this folder. /idea captures one.</Text>
    }

    return (
      <Box flexDirection="column">
        {list.map((idea, index) => (
          <Box key={`row-${index}`}>
            <Button key={`work-${index}`} plain label={previewOf(idea)} onPress={() => workOn($, idea)} />
            <Button key={`delete-${index}`} plain dimColor label="delete" onPress={() => removeIdea($, idea)} />
          </Box>
        ))}
        <Box marginTop={1}>
          <Text dimColor>Pressing an idea puts it into the prompt and removes it from the list.</Text>
        </Box>
      </Box>
    )
  })

  // The terminal draws the mode labels itself, so the count joins them there.
  // On the desktop, status-band draws the footer from the labels it was handed,
  // whichever order the mods load in; only a drawn tree survives that.
  // The desktop app holds a slash command typed mid-turn until the turn ends,
  // so the bulb is drawn even with no ideas: its press reaches the mod at once.
  // With mod-hub loaded, its toolbox takes that place.
  // The desktop draws a footer's buttons ahead of its text, so the bulb takes
  // no separator; one would end up beside the next mod's.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const count = (await read($, ideas)).length
    if (e.surface === 'terminal') {
      return count === 0 ? next(e) : next({ ...e, props: { ...e.props, modes: [...e.props.modes, `💡 ${count}`] } })
    }
    if (await read($, isHubbed)) {
      return next(e)
    }
    const below = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const rest = below.type !== 'engine' ? below : e.props.modes.length === 0 ? null : <Text dimColor>{e.props.modes.join(' & ')}</Text>

    return (
      <Box flexDirection="row" alignItems="center">
        <Button key="capture-idea" plain dimColor label={count === 0 ? '💡' : `💡 ${count}`} onPress={() => openCapture($)} />
        {rest}
      </Box>
    )
  })
}
