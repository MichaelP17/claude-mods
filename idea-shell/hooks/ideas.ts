// One Markdown bullet per idea, continuation lines indented by two spaces.
// Nothing else goes into the file, so reading it costs Claude only the ideas.
export function parseIdeas(text: string): string[] {
  const ideas: string[][] = []
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.startsWith('- ')) {
      ideas.push([line.slice(2)])
      continue
    }
    const current = ideas.at(-1)
    if (current !== undefined) {
      current.push(line.startsWith('  ') ? line.slice(2) : line)
      continue
    }
    // Text written by hand above the first bullet is kept as an idea of its own
    // instead of being dropped on the next save.
    if (line.trim().length > 0) {
      ideas.push([line])
    }
  }

  return ideas.map(i => i.join('\n').trim()).filter(i => i.length > 0)
}

export function formatIdeas(ideas: readonly string[]): string {
  if (ideas.length === 0) {
    return ''
  }
  const blocks = ideas.map(idea => {
    const [first = '', ...rest] = idea.split('\n')
    const continued = rest.map(line => (line.length === 0 ? '' : `  ${line}`))

    return [`- ${first}`, ...continued].join('\n')
  })

  return `${blocks.join('\n')}\n`
}

export function normalizeIdea(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim()
}

// The file mirrors the folder's path, so every folder keeps its own list and the
// same folder maps to the same file on every machine that shares the home layout.
export function ideasFileOf(folder: string, home: string, ideasDirectory: string): string {
  const path = trimSeparators(folder)
  const homePath = trimSeparators(home)
  if (homePath.length > 0 && path === homePath) {
    return `${ideasDirectory}/home.md`
  }
  if (homePath.length > 0 && path.startsWith(`${homePath}/`)) {
    return `${ideasDirectory}/home/${path.slice(homePath.length + 1)}.md`
  }
  const relative = path.replace(/^\/+/, '').replace(/:/g, '')

  return relative.length === 0 ? `${ideasDirectory}/root.md` : `${ideasDirectory}/root/${relative}.md`
}

function trimSeparators(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function previewOf(idea: string): string {
  const [first = ''] = idea.split('\n')

  return idea.includes('\n') ? `${first} …` : first
}

export function numberedList(ideas: readonly string[]): string {
  return ideas.map((idea, index) => `${index + 1}. ${idea.split('\n').join('\n   ')}`).join('\n')
}
