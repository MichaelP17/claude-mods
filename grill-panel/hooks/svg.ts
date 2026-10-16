// An SVG drawn as an image cannot lay out text: no wrapping, no Markdown, no
// measuring. This module does that by estimate and stacks the result into
// cards. Every mod with desktop cards carries the same copy of this file.

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
text{font-family:${SANS};white-space:pre}.mono{font-family:${MONO}}
.card{fill:#f7f6f3;stroke:#e5e3de}.card-accent{fill:#fbf1ec;stroke:#e7b49c}.card-success{fill:#f1f8f3;stroke:#a9d6b8}
.card-warning{fill:#fcf6e6;stroke:#e6cf8a}.card-error{fill:#fcefee;stroke:#e8aaa6}
.tile{fill:#ffffff;stroke:#e5e3de}.tile-accent{fill:#ffffff;stroke:#d97757}.tile-success{fill:#ffffff;stroke:#2e9e5b}
.t{fill:#1f1e1d}.muted{fill:#77756f}.eyebrow{fill:#c9643f}.code{fill:#a2482a}.link{fill:#c9643f}
.success{fill:#2e9e5b}.warning{fill:#a87a06}.error{fill:#c0392b}.accent{fill:#d97757}.on-accent{fill:#ffffff}
.badge{fill:#ecebe7}.badge-t{fill:#4a4844}.codebg{fill:#efede8}.rule{fill:#dad7d0}.pill{fill:#f6e1d7}.pill-success{fill:#dcefe2}
.open{fill:#e4e2dc}.answered{fill:#2e9e5b}.skipped{fill:#d4a017}.current{fill:#d97757}
.current,.pulse{animation:pulse 1.8s ease-in-out infinite}@keyframes pulse{50%{opacity:.5}}
.ripple{transform-box:fill-box;transform-origin:center;animation:ripple 2.4s ease-out infinite}@keyframes ripple{0%{transform:scale(1);opacity:.45}100%{transform:scale(2.8);opacity:0}}
.spin{transform-box:fill-box;transform-origin:center;animation:spin .9s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.dot{animation:dot 1.2s ease-in-out infinite}.dot2{animation-delay:.2s}.dot3{animation-delay:.4s}@keyframes dot{0%,80%,100%{opacity:.25}40%{opacity:1}}
@media (prefers-color-scheme: dark){
.card{fill:#262625;stroke:#363632}.card-accent{fill:#2e2420;stroke:#7a4a36}.card-success{fill:#1f2a23;stroke:#2f5a3d}
.card-warning{fill:#2c2717;stroke:#6a5a24}.card-error{fill:#2e1f1e;stroke:#6e3430}
.tile{fill:#1e1e1d;stroke:#3a3a36}.tile-accent{fill:#1e1e1d;stroke:#e08a6a}.tile-success{fill:#1e1e1d;stroke:#3fb36b}
.t{fill:#ecebe8}.muted{fill:#a5a39d}.eyebrow{fill:#e8916f}.code{fill:#f0a283}.link{fill:#e8916f}
.success{fill:#4cc27a}.warning{fill:#e2b33c}.error{fill:#e8746a}.accent{fill:#e08a6a}.on-accent{fill:#1f1e1d}
.badge{fill:#34342f}.badge-t{fill:#d6d4cf}.codebg{fill:#1c1c1b}.rule{fill:#45443f}.pill{fill:#4a3328}.pill-success{fill:#24432f}
.open{fill:#3a3a37}.answered{fill:#3fb36b}.skipped{fill:#d4a017}.current{fill:#e08a6a}}
@media (prefers-reduced-motion: reduce){.current,.pulse,.dot,.ripple,.spin{animation:none}}
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

// A pane reports its width in columns only; about 8 CSS pixels each, as
// savvy-progress measures it, minus the pane's own inset.
export function cardWidthOf(columns: number): number {
  return Math.max(240, Math.min(900, (columns || 40) * 8 - 8))
}

// The columns a native control laid over a card is pushed in by to clear
// `pixels` of the card, at the same 8 pixels per column.
export function columnsOf(pixels: number): number {
  return Math.ceil(pixels / 8)
}

// About how wide the desktop draws a row of native buttons with these labels,
// for text that has to keep clear of buttons laid over a card.
export function buttonWidthOf(labels: readonly string[]): number {
  return labels.reduce((sum, label) => sum + textWidth(label, 13) + 30, 0) + Math.max(0, labels.length - 1) * 8
}

export function svgDocument(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${STYLE}${body}</svg>`
}

export type Segment = 'answered' | 'skipped' | 'current' | 'open'

export type Card = { source: string; height: number; alt: string }

export type Variant = 'card' | 'card-accent' | 'card-success' | 'card-warning' | 'card-error'

export type Section = { height: number; draw: (y: number) => string }

export const PAD = 18
export const SIZE = 14
export const LINE = 21
export const EYEBROW = 11
export const RADIUS = 14

// The engine refuses an Svg taller than 4096 pixels; a longer card is cut
// between sections into several cards of the same look.
export const MAX_HEIGHT = 4000

export function baseline(y: number, line: number, lineHeight = LINE): number {
  return y + line * lineHeight + lineHeight * 0.72
}

export function frame(width: number, height: number, variant: Variant): string {
  return `<rect class="${variant}" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${RADIUS}"/>`
}

export function eyebrowSvg(text: string, x: number, y: number, tone = 'eyebrow', anchor = 'start'): string {
  return `<text class="${tone}" x="${x}" y="${y}" font-size="${EYEBROW}" font-weight="700" letter-spacing="1.1" text-anchor="${anchor}">${escape(text)}</text>`
}

export function eyebrowWidth(text: string): number {
  return textWidth(text, EYEBROW, true) + text.length * 1.1
}

export function textSection(
  runs: readonly Run[],
  x: number,
  maxWidth: number,
  options: { tone?: string; size?: number; maxLines?: number; weight?: number; firstWidth?: number } = {},
): Section {
  const size = options.size ?? SIZE
  const lineHeight = Math.round(size * 1.5)
  const wrapped = wrapRuns(runs, maxWidth, size, options.firstWidth)
  const lines = options.maxLines === undefined ? wrapped : clampLines(wrapped, options.maxLines, maxWidth, size)

  return {
    height: lines.length * lineHeight,
    draw: y => lines.map((line, index) => lineSvg(line, x, baseline(y, index, lineHeight), size, options.tone, options.weight)).join(''),
  }
}

export function codeSection(lines: readonly string[], x: number, maxWidth: number): Section {
  const size = 12.5
  const lineHeight = 18
  const perLine = Math.max(8, Math.floor((maxWidth - 24) / (size * 0.62)))
  const rows = lines.flatMap(line => {
    const chars = Array.from(line)
    const pieces: string[] = []
    for (let index = 0; index < Math.max(1, chars.length); index += perLine) {
      pieces.push(chars.slice(index, index + perLine).join(''))
    }

    return pieces
  })

  return {
    height: rows.length * lineHeight + 20,
    draw: y =>
      `<rect class="codebg" x="${x}" y="${y}" width="${maxWidth}" height="${rows.length * lineHeight + 20}" rx="8"/>` +
      rows.map((row, index) => lineSvg([{ text: row, isCode: true }], x + 12, baseline(y + 10, index, lineHeight), size / 0.92)).join(''),
  }
}

export function blockSection(block: Block, x: number, maxWidth: number): Section {
  switch (block.kind) {
    case 'code':
      return codeSection(block.lines, x, maxWidth)
    case 'heading':
      return textSection(block.runs, x, maxWidth, { size: SIZE + 1.5, weight: 650 })
    case 'quote': {
      const text = textSection(block.runs, x + 14, maxWidth - 14, { tone: 'muted' })

      return { height: text.height, draw: y => `<rect class="rule" x="${x}" y="${y + 2}" width="3" height="${text.height - 4}" rx="1.5"/>${text.draw(y)}` }
    }
    case 'item': {
      const indent = block.marker === '•' ? 16 : textWidth(block.marker, SIZE) + 8
      const text = textSection(block.runs, x + indent, maxWidth - indent)

      return {
        height: text.height,
        draw: y => `<text class="muted" x="${x + (block.marker === '•' ? 3 : 0)}" y="${baseline(y, 0).toFixed(1)}" font-size="${SIZE}">${escape(block.marker)}</text>${text.draw(y)}`,
      }
    }
    default:
      return textSection(block.runs, x, maxWidth)
  }
}

// Paragraphs sit further apart than the items of one list.
export function blockSections(blocks: readonly Block[], x: number, maxWidth: number): Section[] {
  return blocks.map((block, index) => {
    const section = blockSection(block, x, maxWidth)
    const previous = blocks[index - 1]
    const spacing = index === 0 ? 0 : previous?.kind === 'item' && block.kind === 'item' ? 4 : 10

    return { height: section.height + spacing, draw: y => section.draw(y + spacing) }
  })
}

// Stacks sections inside one frame; past MAX_HEIGHT the rest go on in a next one.
// `minHeight` keeps a short card tall enough for native controls laid over it.
export function cards(width: number, variant: Variant, sections: readonly Section[], alt: string, decoration = '', minHeight = 0): Card[] {
  const result: Card[] = []
  let pending: Section[] = []
  let used = 2 * PAD
  const close = () => {
    if (pending.length === 0) {
      return
    }
    let y = PAD
    const body = pending.map(section => {
      const drawn = section.draw(y)
      y += section.height

      return drawn
    })
    const natural = Math.ceil(y + PAD)
    const height = result.length === 0 ? Math.max(natural, minHeight) : natural
    result.push({ height, alt, source: svgDocument(width, height, frame(width, height, variant) + (result.length === 0 ? decoration : '') + body.join('')) })
    pending = []
    used = 2 * PAD
  }
  for (const section of sections) {
    if (pending.length > 0 && used + section.height > MAX_HEIGHT) {
      close()
    }
    pending.push(section)
    used += section.height
  }
  close()

  return result
}

export const GLOW =
  '<defs><linearGradient id="glow" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d97757" stop-opacity="0.14"/><stop offset="0.55" stop-color="#d97757" stop-opacity="0"/></linearGradient></defs>'

// The card heading a pane: an eyebrow, a count at the right, a title of up
// to two lines and, given segments, a bar with one segment per step.
// `reserve` keeps the title clear of native buttons laid over the right side.
export function headerCard(card: { width: number; eyebrow: string; title: string; counter: string; segments?: readonly Segment[]; reserve?: number }): Card {
  const { width } = card
  const segments = card.segments ?? []
  const inner = width - 2 * PAD
  const counterWidth = textWidth(card.counter, 12)
  const eyebrow = fitText(card.eyebrow, inner - counterWidth - 16, EYEBROW, true)
  const title = textSection(parseInline(card.title).map(i => ({ ...i, isBold: true })), PAD, inner - (card.reserve ?? 0), { size: 17, maxLines: 2 })
  const titleTop = PAD + EYEBROW + 8
  const barY = titleTop + title.height + 12
  const height = segments.length === 0 ? titleTop + title.height + PAD - 4 : barY + 6 + PAD
  const count = Math.max(1, segments.length)
  const segmentWidth = (inner - 4 * (count - 1)) / count
  const bars = segments.map(
    (segment, index) => `<rect class="${segment}" x="${(PAD + index * (segmentWidth + 4)).toFixed(1)}" y="${barY}" width="${segmentWidth.toFixed(1)}" height="6" rx="3"/>`,
  )
  const body = [
    frame(width, height, 'card'),
    GLOW,
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${RADIUS}" fill="url(#glow)"/>`,
    eyebrowSvg(eyebrow, PAD, PAD + EYEBROW),
    `<text class="muted" x="${width - PAD}" y="${PAD + EYEBROW}" font-size="12" text-anchor="end">${escape(card.counter)}</text>`,
    title.draw(titleTop),
    ...bars,
  ]

  return { height, alt: `${card.eyebrow}: ${plainOf(card.title)}, ${card.counter}`, source: svgDocument(width, height, body.join('')) }
}

export function noticeCard(width: number, variant: 'card-warning' | 'card-error', title: string, text: string, reserve = 0): Card[] {
  const inner = width - 2 * PAD - reserve
  const body = textSection([{ text }], PAD, inner, { tone: 'muted' })
  const sections = [textSection([{ text: title, isBold: true }], PAD, inner, { size: 15 }), { height: body.height + 6, draw: (y: number) => body.draw(y + 6) }]

  return cards(width, variant, sections, `${title} ${text}`, '', reserve > 0 ? 72 : 0)
}

const FIELD_HEIGHT = 72

// A card holding a native text field: its label and a hint in a column at the
// left, the rest left free for the field laid over it. `labelWidth` is that
// column's width; the field starts past it.
export function fieldCard(width: number, label: string, hint: string, labelWidth: number): Card {
  const maxWidth = labelWidth - PAD - 12
  const hints = wrapRuns([{ text: hint }], maxWidth, 12).slice(0, 2)
  const top = FIELD_HEIGHT / 2 - (hints.length * 16 + EYEBROW + 6) / 2 + EYEBROW
  const body = [
    frame(width, FIELD_HEIGHT, 'card'),
    eyebrowSvg(fitText(label, maxWidth, EYEBROW, true), PAD, top),
    ...hints.map((line, index) => lineSvg(line, PAD, top + 18 + index * 16, 12, 'muted')),
    `<rect class="rule" x="${labelWidth - 6}" y="16" width="1" height="${FIELD_HEIGHT - 32}"/>`,
  ]

  return { height: FIELD_HEIGHT, alt: `${label}: ${hint}`, source: svgDocument(width, FIELD_HEIGHT, body.join('')) }
}

// Below this width a card leaves too little room beside native controls, so
// they go beneath it instead of over it.
export const ROOMY_WIDTH = 420

// A slim card for a row of native buttons laid over it; given a label, that
// heads the bar at its left, as a section title with its actions beside it.
export function barCard(width: number, alt: string, label = '', variant: Variant = 'card', reserve = 0): Card {
  const height = 56
  const text = label.length === 0 ? '' : eyebrowSvg(fitText(label, width - 2 * PAD - reserve - 12, EYEBROW, true), PAD, height / 2 + EYEBROW / 2 - 1)

  return { height, alt, source: svgDocument(width, height, frame(width, height, variant) + text) }
}

// A diff or a list of changes in the code font: added lines green, removed
// ones red, hunk heads in the accent color. Long lines are cut, not wrapped,
// so the columns stay aligned.
export function diffCards(width: number, text: string, alt: string): Card[] {
  const size = 12
  const lineHeight = 17
  const maxWidth = width - 2 * PAD
  const rows = text.replace(/\s+$/u, '').split('\n')
  const toneOf = (row: string) =>
    /^\+(?!\+\+)/u.test(row) ? 'success' : /^-(?!--)/u.test(row) ? 'error' : /^@@/u.test(row) ? 'accent' : /^(diff |index |\+\+\+|---)/u.test(row) ? 'muted' : 't'
  const sections: Section[] = rows.map(row => ({
    height: lineHeight,
    draw: y =>
      `<text class="${toneOf(row)} mono" x="${PAD}" y="${(y + lineHeight * 0.75).toFixed(1)}" font-size="${size}">${escape(fitMono(row, maxWidth, size))}</text>`,
  }))

  return cards(width, 'card', sections, alt)
}

function fitMono(text: string, maxWidth: number, size: number): string {
  const chars = Array.from(text.replace(/\t/gu, '  '))
  const fits = Math.floor(maxWidth / (size * 0.62))

  return chars.length <= fits ? chars.join('') : `${chars.slice(0, Math.max(1, fits - 1)).join('')}…`
}

// An eyebrow line heading a card, with an optional second one at its right.
export function eyebrowSection(left: string, right: string | null, rightTone: string, width: number): Section {
  return {
    height: EYEBROW + 10,
    draw: y => eyebrowSvg(left, PAD, y + EYEBROW) + (right === null ? '' : eyebrowSvg(right, width - PAD, y + EYEBROW, rightTone, 'end')),
  }
}
