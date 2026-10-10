import { expect, test } from 'claude-code/testing'

import type { ShellFacts } from './shell'
import { parseFacts, rewrite, scan } from './shell'

const FACTS: ShellFacts = {
  aliases: new Set(['ls', 'g', 'la', 'egrep']),
  shadowing: new Set(['ls', 'egrep']),
  hasTimeout: false,
}

const BIN = '/mods/shell-shim/bin'

function fixed(command: string, facts: ShellFacts = FACTS): string | null {
  return rewrite(command, facts, BIN)?.command ?? null
}

test('a word starting with = turns equals expansion off', () => {
  expect(fixed('echo status; echo ======; echo done')).toBe('setopt no_equals 2>/dev/null; echo status; echo ======; echo done')
  expect(fixed('[ "$a" == "b" ] && echo same')).toBe('setopt no_equals 2>/dev/null; [ "$a" == "b" ] && echo same')
  expect(fixed('[ "$a" = "b" ] && echo same')).toBeNull()
})

test('bash idioms that rely on splitting a value get word splitting', () => {
  expect(fixed('G="git --git-dir=/x"; $G status')).toBe('setopt sh_word_split 2>/dev/null; G="git --git-dir=/x"; $G status')
  expect(fixed('for spec in "1 a"; do set -- $spec; echo $2; done')).toContain('setopt sh_word_split')
  expect(fixed('for file in $FILES; do echo "$file"; done')).toContain('setopt sh_word_split')
  expect(fixed('parts=($LINE)')).toContain('setopt sh_word_split')
})

test('an expansion used as a plain argument keeps zsh splitting, so paths with spaces survive', () => {
  expect(fixed('D="/tmp/a b"; mkdir -p $D')).toBeNull()
  expect(fixed('echo "$G" ${HOME}')).toBeNull()
})

test('unquoted glob characters pass through unmatched, as in bash', () => {
  expect(fixed('grep -rn --include=*.cs foo .')).toBe('setopt no_nomatch 2>/dev/null; grep -rn --include=*.cs foo .')
  expect(fixed('curl -s https://x.test/a?b=1')).toContain('setopt no_nomatch')
  expect(fixed('echo "*.txt" \'a?\'')).toBeNull()
  expect(fixed('x=*.none; echo "$x"')).toBeNull()
  expect(fixed('[[ $x == *.txt ]] && echo match')).toBeNull()
})

test('several options share one setopt', () => {
  expect(fixed('echo ===; rm -f out/*')).toBe('setopt no_equals no_nomatch 2>/dev/null; echo ===; rm -f out/*')
})

test('an alias that hides a program is bypassed wherever it runs as a command', () => {
  expect(fixed('ls -t /tmp | head -1')).toBe('\\ls -t /tmp | head -1')
  expect(fixed('cd app && ls -la; egrep x y')).toBe('cd app && \\ls -la; \\egrep x y')
  expect(fixed('echo "newest: $(ls -t | head -1)"')).toBe('echo "newest: $(\\ls -t | head -1)"')
  expect(fixed('if true; then ls; fi')).toBe('if true; then \\ls; fi')
  expect(fixed('echo ls la')).toBeNull()
  expect(fixed('la')).toBeNull()
})

test('a function named like an alias is defined and called past the alias', () => {
  expect(fixed('g() { git --git-dir=/x "$@"; }; g log -1')).toBe('\\g() { git --git-dir=/x "$@"; }; \\g log -1')
  expect(fixed('function g { echo fn; }; g')).toBe('function g { echo fn; }; \\g')
  expect(fixed('h() { echo h; }; h')).toBeNull()
})

test('a missing timeout comes from the mod\'s bin folder, a real one is left alone', () => {
  expect(fixed('timeout 300 node render.mjs')).toBe(`PATH="$PATH":'${BIN}'; timeout 300 node render.mjs`)
  expect(fixed('timeout 300 node render.mjs', { ...FACTS, hasTimeout: true })).toBeNull()
  expect(fixed('timeout() { gtimeout "$@"; }; timeout 5 x')).toBeNull()
  expect(rewrite('timeout 1 ls *.x', FACTS, "/a'b")?.command).toBe(
    `setopt no_nomatch 2>/dev/null; PATH="$PATH":'/a'\\''b'; timeout 1 ls *.x`,
  )
})

test('heredoc bodies, quotes and comments are data', () => {
  expect(fixed("cat <<'EOF' > notes.md\nls -t =x *.md\nEOF")).toBeNull()
  expect(fixed('python3 - <<EOF\nprint("=== done")\nEOF\nls')).toBe('python3 - <<EOF\nprint("=== done")\nEOF\n\\ls')
  expect(fixed("git commit -m 'ls *.md == ok'")).toBeNull()
  expect(fixed('echo done # ls *.x ==')).toBeNull()
})

test('a command that starts with sleep stays as written', () => {
  expect(fixed('sleep 60; ls -t build/*.log')).toBeNull()
})

test('redirections and arithmetic are not mistaken for words', () => {
  expect(fixed('make 2>&1 | tail -3')).toBeNull()
  expect(fixed('echo $((1 + 2)) &>/dev/null')).toBeNull()
  expect(fixed('diff <(ls a) <(ls b)')).toBe('diff <(\\ls a) <(\\ls b)')
})

test('the scanner reports definitions and command words', () => {
  const findings = scan('x=1 env FOO=2 ls; g() { :; }')
  expect(findings.commandWords.map(i => i.text)).toEqual(['env', 'g', '{', ':', '}'])
  expect(findings.definitions).toEqual(['g'])
})

test('the probe output becomes the facts', () => {
  const facts = parseFacts('timeout:\nalias:ls\nshadow:ls\nalias:g\nalias:url:x\n')
  expect([...facts.aliases]).toEqual(['ls', 'g', 'url:x'])
  expect([...facts.shadowing]).toEqual(['ls'])
  expect(facts.hasTimeout).toBe(false)
  expect(parseFacts('timeout:/usr/bin/timeout\n').hasTimeout).toBe(true)
})
