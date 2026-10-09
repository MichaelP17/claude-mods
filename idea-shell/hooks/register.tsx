import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { formatIdeas, ideasFileOf, normalizeIdea, numberedList, parseIdeas, previewOf } from './ideas'

const CAPTURE_PANE = 'idea'
const LIST_PANE = 'ideas'
const LIST_TOOL = 'mcp__idea-shell__ideas_list'
const REMOVE_TOOL = 'mcp__idea-shell__idea_remove'

const ideas = atom({ plugin: 'idea-shell', key: 'ideas' } as const, [])

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
    await load($)
    await $.ui.open({ id: CAPTURE_PANE, title: 'New idea', focus: true, closeOnEscape: true, rows: 4 })

    return {}
  })

  on('command.run', { command: 'ideas' }, async $ => {
    await load($)
    await $.ui.open({ id: LIST_PANE, title: 'Ideas', focus: true, closeOnEscape: true })

    return {}
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
    const elements = $.ui.resolve(e)
    const { Box, Text } = elements
    // Reading the list makes every save redraw the pane, which empties the field.
    const count = (await read($, ideas)).length
    // The desktop app's field is a single line, where Shift+Enter saves like Enter.
    const lineBreak = e.surface === 'terminal' ? ' · Shift+Enter adds a line' : ''
    const hint = `${count} ${count === 1 ? 'idea' : 'ideas'} for this folder${lineBreak} · Esc closes`
    if (!('Input' in elements)) {
      return <Text dimColor>This app draws no text field. /idea followed by the idea saves it.</Text>
    }
    const { Input } = elements

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
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const count = (await read($, ideas)).length
    if (count === 0) {
      return next(e)
    }
    const label = `💡 ${count}`
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
