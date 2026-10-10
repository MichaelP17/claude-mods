// What the shell the Bash tool runs in knows: every alias, the aliases that
// hide a real program of the same name (ls → eza), and whether `timeout` exists.
export type ShellFacts = {
  aliases: ReadonlySet<string>
  shadowing: ReadonlySet<string>
  hasTimeout: boolean
}

export type Findings = {
  needsNoEquals: boolean
  needsNoNomatch: boolean
  needsWordSplit: boolean
  commandWords: CommandWord[]
  definitions: string[]
}

export type CommandWord = {
  start: number
  text: string
}

export type Rewrite = {
  command: string
  fixes: string[]
}

type Word = {
  start: number
  end: number
  literal: string | null
  startsWithEquals: boolean
  hasGlob: boolean
  hasParameter: boolean
  isAssignment: boolean
}

// Words after these are in command position again, where zsh expands aliases.
const KEYWORDS = new Set(['!', 'if', 'then', 'else', 'elif', 'do', 'while', 'until', '{', 'time'])

const ALIAS_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/

class Scanner {
  private index = 0
  private readonly heredocs: { delimiter: string; stripsTabs: boolean }[] = []
  readonly findings: Findings = {
    needsNoEquals: false,
    needsNoNomatch: false,
    needsWordSplit: false,
    commandWords: [],
    definitions: [],
  }

  constructor(private readonly text: string) {}

  private at(offset = 0): string {
    return this.text[this.index + offset] ?? ''
  }

  // One list of commands, up to `terminator` (the `)` of `$(`, a backtick) or
  // the end. Mis-reading an odd construct is harmless: rewrites only touch
  // unquoted words, where a backslash before a letter changes nothing.
  scanList(terminator: ')' | '`' | null): void {
    let isCommandStart = true
    let isInTest = false
    let isLoopList = false
    let isLoopHeader = false
    let isFunctionName = false
    let command: string | null = null
    while (this.index < this.text.length) {
      const char = this.at()
      if (terminator !== null && char === terminator) {
        this.index += 1
        return
      }
      if (char === '\n') {
        this.index += 1
        this.skipHeredocBodies()
        isCommandStart = true
        isLoopList = false
        isLoopHeader = false
        command = null
        continue
      }
      if (char === ' ' || char === '\t') {
        this.index += 1
        continue
      }
      if (char === '#' ) {
        while (this.index < this.text.length && this.at() !== '\n') {
          this.index += 1
        }
        continue
      }
      if (char === ';' || char === '|' || (char === '&' && this.at(1) !== '>')) {
        this.index += char === this.at(1) ? 2 : 1
        if (char === '|' && this.at() === '&') {
          this.index += 1
        }
        isCommandStart = true
        isInTest = false
        isLoopList = false
        isLoopHeader = false
        command = null
        continue
      }
      if (char === '(' && this.at(1) === '(') {
        this.skipArithmetic(2)
        isCommandStart = false
        continue
      }
      if (char === '(') {
        this.index += 1
        this.scanList(')')
        isCommandStart = false
        continue
      }
      if (char === ')') {
        this.index += 1
        continue
      }
      if (char === '<' || char === '>' || char === '&') {
        this.scanRedirection()
        continue
      }
      const word = this.scanWord()
      if (word.end === word.start) {
        this.index += 1
        continue
      }
      if (/^\d+$/.test(word.literal ?? '') && (this.at() === '<' || this.at() === '>')) {
        continue
      }
      if (isFunctionName) {
        isFunctionName = false
        if (word.literal !== null) {
          this.findings.definitions.push(word.literal)
        }
        if (this.isDefinitionAhead()) {
          this.index = this.text.indexOf(')', this.index) + 1
        }
        isCommandStart = true
        continue
      }
      if (isCommandStart) {
        if (word.isAssignment) {
          if (this.at() === '(') {
            this.scanArrayLiteral()
          }
          continue
        }
        isCommandStart = false
        command = word.literal
        if (word.literal === null) {
          // `$cmd args`: bash splits the value into a command and its words.
          this.findings.needsWordSplit ||= word.hasParameter
          continue
        }
        this.findings.commandWords.push({ start: word.start, text: word.literal })
        if (this.isDefinitionAhead()) {
          this.findings.definitions.push(word.literal)
          this.index = this.text.indexOf(')', this.index) + 1
          isCommandStart = true
          continue
        }
        if (KEYWORDS.has(word.literal)) {
          isCommandStart = true
        } else if (word.literal === 'function') {
          isFunctionName = true
        } else if (word.literal === '[[') {
          isInTest = true
        } else if (word.literal === 'for' || word.literal === 'select' || word.literal === 'foreach') {
          isLoopHeader = true
        }
        continue
      }
      if (isInTest) {
        isInTest = word.literal !== ']]'
        continue
      }
      if (isLoopHeader && word.literal === 'in') {
        isLoopHeader = false
        isLoopList = true
        continue
      }
      if (isLoopList || command === 'set') {
        this.findings.needsWordSplit ||= word.hasParameter
      }
      if (word.literal === 'do' && (isLoopList || isLoopHeader)) {
        isLoopList = false
        isLoopHeader = false
        isCommandStart = true
        continue
      }
      // A lone `=` is a test operator; `==` and `=word` are what zsh expands.
      this.findings.needsNoEquals ||= word.startsWithEquals
      this.findings.needsNoNomatch ||= word.hasGlob
    }
  }

  private isDefinitionAhead(): boolean {
    let offset = 0
    while (this.at(offset) === ' ' || this.at(offset) === '\t') {
      offset += 1
    }

    return this.at(offset) === '(' && this.at(offset + 1) === ')'
  }

  private scanArrayLiteral(): void {
    this.index += 1
    while (this.index < this.text.length && this.at() !== ')') {
      if (/\s/.test(this.at())) {
        this.index += 1
        continue
      }
      const word = this.scanWord()
      this.findings.needsWordSplit ||= word.hasParameter
      if (word.end === word.start) {
        this.index += 1
      }
    }
    this.index += 1
  }

  private scanRedirection(): void {
    const operator = /^(<<<|<<-?|<>|<&|>&|>>|>\||&>>|&>|<|>)/.exec(this.text.slice(this.index))?.[0] ?? this.at()
    this.index += operator.length
    if ((operator === '<' || operator === '>') && this.at() === '(') {
      this.index += 1
      this.scanList(')')
      return
    }
    while (this.at() === ' ' || this.at() === '\t') {
      this.index += 1
    }
    const target = this.scanWord()
    if (operator === '<<' || operator === '<<-') {
      const delimiter = this.text.slice(target.start, target.end).replace(/['"\\]/g, '')
      this.heredocs.push({ delimiter, stripsTabs: operator === '<<-' })
    }
  }

  private skipHeredocBodies(): void {
    while (this.heredocs.length > 0) {
      const heredoc = this.heredocs.shift()
      if (heredoc === undefined) {
        return
      }
      while (this.index < this.text.length) {
        const lineEnd = this.text.indexOf('\n', this.index)
        const end = lineEnd === -1 ? this.text.length : lineEnd
        const line = this.text.slice(this.index, end)
        this.index = lineEnd === -1 ? end : end + 1
        if ((heredoc.stripsTabs ? line.replace(/^\t+/, '') : line) === heredoc.delimiter) {
          break
        }
      }
    }
  }

  private skipArithmetic(opening: number): void {
    let depth = 0
    this.index += opening
    while (this.index < this.text.length) {
      const char = this.at()
      if (char === '(') {
        depth += 1
      } else if (char === ')') {
        if (depth === 0) {
          this.index += this.at(1) === ')' ? 2 : 1
          return
        }
        depth -= 1
      }
      this.index += 1
    }
  }

  private skipBraced(): void {
    let depth = 0
    while (this.index < this.text.length) {
      const char = this.at()
      if (char === '\\') {
        this.index += 2
        continue
      }
      if (char === '\'' ) {
        this.skipSingleQuoted()
        continue
      }
      if (char === '{') {
        depth += 1
      } else if (char === '}') {
        depth -= 1
        if (depth === 0) {
          this.index += 1
          return
        }
      }
      this.index += 1
    }
  }

  private skipSingleQuoted(): void {
    const end = this.text.indexOf('\'', this.index + 1)
    this.index = end === -1 ? this.text.length : end + 1
  }

  private skipAnsiQuoted(): void {
    this.index += 2
    while (this.index < this.text.length && this.at() !== '\'') {
      this.index += this.at() === '\\' ? 2 : 1
    }
    this.index += 1
  }

  // Inside double quotes nothing splits or globs; only `$(` and backticks hold
  // commands of their own.
  private skipDoubleQuoted(): void {
    this.index += 1
    while (this.index < this.text.length) {
      const char = this.at()
      if (char === '"') {
        this.index += 1
        return
      }
      if (char === '\\') {
        this.index += 2
      } else if (char === '$' && this.at(1) === '(' && this.at(2) === '(') {
        this.index += 1
        this.skipArithmetic(2)
      } else if (char === '$' && this.at(1) === '(') {
        this.index += 2
        this.scanList(')')
      } else if (char === '$' && this.at(1) === '{') {
        this.index += 1
        this.skipBraced()
      } else if (char === '`') {
        this.index += 1
        this.scanList('`')
      } else {
        this.index += 1
      }
    }
  }

  private scanWord(): Word {
    const start = this.index
    let isLiteral = true
    let hasGlob = false
    let hasParameter = false
    const startsWithEquals = this.at() === '=' && this.at(1) !== '' && !/[\s;&|()<>]/.test(this.at(1))
    while (this.index < this.text.length) {
      const char = this.at()
      if (/[\s;&|()<>]/.test(char)) {
        break
      }
      if (char === '\\') {
        isLiteral = false
        this.index += 2
      } else if (char === '\'') {
        isLiteral = false
        this.skipSingleQuoted()
      } else if (char === '"') {
        isLiteral = false
        this.skipDoubleQuoted()
      } else if (char === '$' && this.at(1) === '\'') {
        isLiteral = false
        this.skipAnsiQuoted()
      } else if (char === '$' && this.at(1) === '(' && this.at(2) === '(') {
        isLiteral = false
        this.index += 1
        this.skipArithmetic(2)
      } else if (char === '$' && this.at(1) === '(') {
        isLiteral = false
        this.index += 2
        this.scanList(')')
      } else if (char === '$' && this.at(1) === '{') {
        isLiteral = false
        hasParameter = true
        this.index += 1
        this.skipBraced()
      } else if (char === '$' && /[A-Za-z_]/.test(this.at(1))) {
        isLiteral = false
        hasParameter = true
        this.index += 1
        while (/[A-Za-z0-9_]/.test(this.at())) {
          this.index += 1
        }
      } else if (char === '$' && /[0-9@*#?!$-]/.test(this.at(1))) {
        isLiteral = false
        hasParameter = true
        this.index += 2
      } else if (char === '`') {
        isLiteral = false
        this.index += 1
        this.scanList('`')
      } else {
        hasGlob ||= char === '*' || char === '?' || char === '['
        this.index += 1
      }
    }
    const raw = this.text.slice(start, this.index)

    return {
      start,
      end: this.index,
      literal: isLiteral ? raw : null,
      startsWithEquals,
      hasGlob,
      hasParameter,
      isAssignment: /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=/.test(raw),
    }
  }
}

export function scan(command: string): Findings {
  const scanner = new Scanner(command)
  scanner.scanList(null)

  return scanner.findings
}

function firstCommandOf(findings: Findings): string | undefined {
  return findings.commandWords[0]?.text
}

// `timeout` comes from the mod's own bin folder, appended to PATH so a real one
// installed later always wins.
export function rewrite(command: string, facts: ShellFacts, binDirectory: string): Rewrite | null {
  const findings = scan(command)
  // A leading sleep is how Claude polls; Claude Code refuses that on purpose, and
  // a prefix in front of it would hide the sleep from that check.
  if (firstCommandOf(findings) === 'sleep') {
    return null
  }
  const redefined = new Set(findings.definitions.filter(i => facts.aliases.has(i)))
  const bypassed = findings.commandWords.filter(
    i => ALIAS_NAME.test(i.text) && (facts.shadowing.has(i.text) || redefined.has(i.text)),
  )
  const isTimeoutMissing =
    !facts.hasTimeout && findings.commandWords.some(i => i.text === 'timeout') && !findings.definitions.includes('timeout')
  const options = [
    findings.needsNoEquals ? 'no_equals' : null,
    findings.needsNoNomatch ? 'no_nomatch' : null,
    findings.needsWordSplit ? 'sh_word_split' : null,
  ].filter(i => i !== null)
  if (bypassed.length === 0 && options.length === 0 && !isTimeoutMissing) {
    return null
  }
  let body = command
  for (const word of [...bypassed].sort((a, b) => b.start - a.start)) {
    body = `${body.slice(0, word.start)}\\${body.slice(word.start)}`
  }
  const prefixes = [
    options.length > 0 ? `setopt ${options.join(' ')} 2>/dev/null` : null,
    isTimeoutMissing ? `PATH="$PATH":${shellQuote(binDirectory)}` : null,
  ].filter(i => i !== null)
  const fixes = [
    ...options,
    ...[...new Set(bypassed.map(i => i.text))].map(i => `\\${i}`),
    ...(isTimeoutMissing ? ['timeout'] : []),
  ]

  return { command: prefixes.length > 0 ? `${prefixes.join('; ')}; ${body}` : body, fixes }
}

function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}

// The probe prints one line per fact; see register.ts for the script.
export function parseFacts(output: string): ShellFacts {
  const aliases = new Set<string>()
  const shadowing = new Set<string>()
  let hasTimeout = false
  for (const line of output.split('\n')) {
    const [kind = '', ...rest] = line.split(':')
    const value = rest.join(':')
    if (kind === 'alias') {
      aliases.add(value)
    } else if (kind === 'shadow') {
      shadowing.add(value)
    } else if (kind === 'timeout') {
      hasTimeout = value.length > 0
    }
  }

  return { aliases, shadowing, hasTimeout }
}
