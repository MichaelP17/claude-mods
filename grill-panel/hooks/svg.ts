// An SVG drawn as an image cannot lay out text: no wrapping, no Markdown, no
// measuring. This module does that by estimate, so the cards in look.ts can
// show a question as the conversation would.

export type Run = { text: string; isBold?: boolean; isItalic?: boolean; isCode?: boolean; isLink?: boolean }

export type Block =
  | { kind: 'paragraph'; runs: Run[] }
  | { kind: 'heading'; runs: Run[] }
  | { kind: 'quote'; runs: Run[] }
  | { kind: 'item'; marker: string; runs: Run[] }
  | { kind: 'code'; lines: string[] }

export const SANS = '-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,system-ui,sans-serif'
export const MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace'

// Classes rather than colors: drawn as an image the SVG follows the light or
// dark color scheme by itself, which a color handed in from the hook could not.
export const STYLE = `<style>
text{font-family:${SANS};white-space:pre}
.card{fill:#f7f6f3;stroke:#e5e3de}.card-accent{fill:#fbf1ec;stroke:#e7b49c}.card-success{fill:#f1f8f3;stroke:#a9d6b8}
.card-warning{fill:#fcf6e6;stroke:#e6cf8a}.card-error{fill:#fcefee;stroke:#e8aaa6}
.tile{fill:#ffffff;stroke:#e5e3de}.tile-accent{fill:#ffffff;stroke:#d97757}.tile-success{fill:#ffffff;stroke:#2e9e5b}
.t{fill:#1f1e1d}.muted{fill:#77756f}.eyebrow{fill:#c9643f}.code{fill:#a2482a}.link{fill:#c9643f}
.success{fill:#2e9e5b}.warning{fill:#a87a06}.error{fill:#c0392b}.accent{fill:#d97757}.on-accent{fill:#ffffff}
.badge{fill:#ecebe7}.badge-t{fill:#4a4844}.codebg{fill:#efede8}.rule{fill:#dad7d0}.pill{fill:#f6e1d7}.pill-success{fill:#dcefe2}
.open{fill:#e4e2dc}.answered{fill:#2e9e5b}.skipped{fill:#d4a017}.current{fill:#d97757}
.current,.pulse{animation:pulse 1.8s ease-in-out infinite}@keyframes pulse{50%{opacity:.5}}
.dot{animation:dot 1.2s ease-in-out infinite}.dot2{animation-delay:.2s}.dot3{animation-delay:.4s}@keyframes dot{0%,80%,100%{opacity:.25}40%{opacity:1}}
@media (prefers-color-scheme: dark){
.card{fill:#262625;stroke:#363632}.card-accent{fill:#2e2420;stroke:#7a4a36}.card-success{fill:#1f2a23;stroke:#2f5a3d}
.card-warning{fill:#2c2717;stroke:#6a5a24}.card-error{fill:#2e1f1e;stroke:#6e3430}
.tile{fill:#1e1e1d;stroke:#3a3a36}.tile-accent{fill:#1e1e1d;stroke:#e08a6a}.tile-success{fill:#1e1e1d;stroke:#3fb36b}
.t{fill:#ecebe8}.muted{fill:#a5a39d}.eyebrow{fill:#e8916f}.code{fill:#f0a283}.link{fill:#e8916f}
.success{fill:#4cc27a}.warning{fill:#e2b33c}.error{fill:#e8746a}.accent{fill:#e08a6a}.on-accent{fill:#1f1e1d}
.badge{fill:#34342f}.badge-t{fill:#d6d4cf}.codebg{fill:#1c1c1b}.rule{fill:#45443f}.pill{fill:#4a3328}.pill-success{fill:#24432f}
.open{fill:#3a3a37}.answered{fill:#3fb36b}.skipped{fill:#d4a017}.current{fill:#e08a6a}}
@media (prefers-reduced-motion: reduce){.current,.pulse,.dot{animation:none}}
</style>`

// Widths are estimated from the font size, on the wide side: a line then ends
// a little early rather than past the card's edge.
export function textWidth(text: string, size: number, isBold = false, isMono = false): number {
  if (isMono) {
    return Array.from(text).length * size * 0.62
  }
  let units = 0
  for (const char of text) {
    if (/[\s.,:;'|!ijlI]/u.test(char)) {
      units += 0.3
    } else if (/[A-Z@%&MWmw]/u.test(char)) {
      units += 0.74
    } else if (/\p{Extended_Pictographic}/u.test(char)) {
      units += 1.15
    } else {
      units += 0.53
    }
  }

  return units * size * (isBold ? 1.04 : 1)
}

function runWidth(run: Run, size: number): number {
  return textWidth(run.text, size, run.isBold === true, run.isCode === true)
}

export function fitText(text: string, maxWidth: number, size: number, isBold = false): string {
  if (textWidth(text, size, isBold) <= maxWidth) {
    return text
  }
  const chars = Array.from(text)
  while (chars.length > 0 && textWidth(`${chars.join('')}…`, size, isBold) > maxWidth) {
    chars.pop()
  }

  return `${chars.join('').trimEnd()}…`
}

export function escape(text: string): string {
  return text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;')
}

const INLINE = /(\*\*[^*]+?\*\*|__[^_]+?__|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|(?<![\w*])\*(?!\s)[^*]+?(?<!\s)\*(?!\w))/gu

export function parseInline(text: string): Run[] {
  const runs: Run[] = []
  let last = 0
  for (const match of text.matchAll(INLINE)) {
    const [token] = match
    if (match.index > last) {
      runs.push({ text: text.slice(last, match.index) })
    }
    if (token.startsWith('**') || token.startsWith('__')) {
      runs.push(...parseInline(token.slice(2, -2)).map(i => ({ ...i, isBold: true })))
    } else if (token.startsWith('`')) {
      runs.push({ text: token.slice(1, -1), isCode: true })
    } else if (token.startsWith('[')) {
      runs.push({ text: token.slice(1, token.indexOf('](')), isLink: true })
    } else {
      runs.push(...parseInline(token.slice(1, -1)).map(i => ({ ...i, isItalic: true })))
    }
    last = match.index + token.length
  }
  if (last < text.length) {
    runs.push({ text: text.slice(last) })
  }

  return runs.filter(i => i.text.length > 0)
}

export function plainOf(text: string): string {
  return parseInline(text)
    .map(i => i.text)
    .join('')
}

const ITEM = /^\s*([-*•+]|\d{1,3}[.)])\s+(.*)$/u
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/u
const QUOTE = /^\s*>\s?(.*)$/u
const FENCE = /^\s*(```|~~~)/u

// Single line breaks join a paragraph, as Markdown reads them; a list item,
// heading, quote or code fence starts a block of its own.
export function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []
  let item: { marker: string; text: string[] } | null = null
  let quote: string[] = []
  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', runs: parseInline(paragraph.join(' ')) })
    }
    if (item !== null) {
      blocks.push({ kind: 'item', marker: item.marker, runs: parseInline(item.text.join(' ')) })
    }
    if (quote.length > 0) {
      blocks.push({ kind: 'quote', runs: parseInline(quote.join(' ')) })
    }
    paragraph = []
    item = null
    quote = []
  }
  const lines = markdown.replace(/\r\n?/gu, '\n').split('\n')
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? ''
    if (FENCE.test(line)) {
      flush()
      const code: string[] = []
      index += 1
      while (index < lines.length && !FENCE.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      blocks.push({ kind: 'code', lines: code })
      continue
    }
    if (line.trim().length === 0) {
      flush()
      continue
    }
    const heading = HEADING.exec(line)
    if (heading !== null) {
      flush()
      blocks.push({ kind: 'heading', runs: parseInline(heading[1] ?? '') })
      continue
    }
    const listed = ITEM.exec(line)
    if (listed !== null) {
      flush()
      const marker = listed[1] ?? '-'
      item = { marker: /\d/u.test(marker) ? marker : '•', text: [listed[2] ?? ''] }
      continue
    }
    const quoted = QUOTE.exec(line)
    if (quoted !== null) {
      if (quote.length === 0) {
        flush()
      }
      quote.push(quoted[1] ?? '')
      continue
    }
    if (item !== null && /^\s+\S/u.test(line)) {
      item.text.push(line.trim())
      continue
    }
    if (item !== null || quote.length > 0) {
      flush()
    }
    paragraph.push(line.trim())
  }
  flush()

  return blocks
}

type Word = Run & { hasSpace: boolean }

function wordsOf(runs: readonly Run[]): Word[] {
  const words: Word[] = []
  for (const run of runs) {
    for (const piece of run.text.split(/(\s+)/u)) {
      if (piece.length === 0) {
        continue
      }
      if (/^\s+$/u.test(piece)) {
        const previous = words.at(-1)
        if (previous !== undefined) {
          previous.hasSpace = true
        }
        continue
      }
      words.push({ ...run, text: piece, hasSpace: false })
    }
  }

  return words
}

function sameStyle(first: Run, second: Run): boolean {
  return first.isBold === second.isBold && first.isItalic === second.isItalic && first.isCode === second.isCode && first.isLink === second.isLink
}

function breakWord(word: Word, maxWidth: number, size: number): Word[] {
  const pieces: Word[] = []
  let current = ''
  for (const char of word.text) {
    if (current.length > 0 && runWidth({ ...word, text: current + char }, size) > maxWidth) {
      pieces.push({ ...word, text: current, hasSpace: false })
      current = ''
    }
    current += char
  }
  pieces.push({ ...word, text: current })

  return pieces
}

// Greedy, word by word; a word wider than the line is broken by characters.
// `firstWidth` keeps the first line clear of a badge drawn at its end.
export function wrapRuns(runs: readonly Run[], maxWidth: number, size: number, firstWidth = maxWidth): Run[][] {
  const lines: Word[][] = []
  let line: Word[] = []
  let width = 0
  const space = textWidth(' ', size)
  const words = wordsOf(runs).flatMap(i => (runWidth(i, size) > maxWidth ? breakWord(i, maxWidth, size) : [i]))
  for (const word of words) {
    const previous = line.at(-1)
    const gap = previous?.hasSpace === true ? space : 0
    const wordWidth = runWidth(word, size)
    if (line.length > 0 && width + gap + wordWidth > (lines.length === 0 ? firstWidth : maxWidth)) {
      lines.push(line)
      line = []
      width = 0
    }
    width += (line.length > 0 ? gap : 0) + wordWidth
    line.push(word)
  }
  if (line.length > 0) {
    lines.push(line)
  }

  // The space after a code span is drawn in the text's font, not the code's
  // wider one.
  return lines.map(words => {
    const merged: Run[] = []
    const append = (run: Run) => {
      const previous = merged.at(-1)
      if (previous !== undefined && sameStyle(previous, run)) {
        previous.text += run.text
      } else {
        merged.push({ ...run })
      }
    }
    words.forEach((word, index) => {
      const { hasSpace, ...run } = word
      const hasGap = hasSpace && index < words.length - 1
      if (run.isCode === true) {
        append(run)
        if (hasGap) {
          append({ text: ' ' })
        }
      } else {
        append({ ...run, text: run.text + (hasGap ? ' ' : '') })
      }
    })

    return merged
  })
}

// Cuts wrapped lines to `maxLines`, the last one ending in an ellipsis.
export function clampLines(lines: Run[][], maxLines: number, maxWidth: number, size: number): Run[][] {
  if (lines.length <= maxLines) {
    return lines
  }
  const kept = lines.slice(0, maxLines)
  const last = kept[maxLines - 1] ?? []
  const text = last.map(i => i.text).join('')
  kept[maxLines - 1] = [{ ...(last[0] ?? { text: '' }), text: fitText(`${text}…`, maxWidth, size, last[0]?.isBold === true) }]

  return kept
}

export function lineSvg(runs: readonly Run[], x: number, y: number, size: number, tone = 't', weight?: number): string {
  const spans = runs.map(run => {
    const classes = run.isCode ? 'code' : run.isLink ? 'link' : tone
    const attributes = [
      `class="${classes}"`,
      run.isBold === true || weight !== undefined ? `font-weight="${run.isBold === true ? 650 : weight}"` : '',
      run.isItalic === true ? 'font-style="italic"' : '',
      run.isCode === true ? `font-family="${MONO}" font-size="${(size * 0.92).toFixed(1)}"` : '',
      run.isLink === true ? 'text-decoration="underline"' : '',
    ].filter(i => i.length > 0)

    return `<tspan ${attributes.join(' ')}>${escape(run.text)}</tspan>`
  })

  return `<text x="${x}" y="${y.toFixed(1)}" font-size="${size}">${spans.join('')}</text>`
}

export function svgDocument(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${STYLE}${body}</svg>`
}
