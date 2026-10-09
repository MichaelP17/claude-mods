import { expect, test } from 'claude-code/testing'

import { formatIdeas, ideasFileOf, numberedList, parseIdeas, previewOf } from './ideas'

test('ideas survive a write and a read, multi-line ones included', async () => {
  const ideas = ['Make the timeout configurable', 'Split the importer\n\nfirst by source, then by format']
  const text = formatIdeas(ideas)
  expect(text).toBe('- Make the timeout configurable\n- Split the importer\n\n  first by source, then by format\n')
  expect(parseIdeas(text)).toEqual(ideas)
})

test('an empty list is an empty file', async () => {
  expect(formatIdeas([])).toBe('')
  expect(parseIdeas('')).toEqual([])
  expect(parseIdeas('\n\n')).toEqual([])
})

test('text edited by hand is kept instead of dropped', async () => {
  const text = 'loose note above\n- first\nnot indented\n-  second\r\n'
  expect(parseIdeas(text)).toEqual(['loose note above', 'first\nnot indented', 'second'])
})

test('each folder maps to its own file, mirroring its path', async () => {
  const home = '/Users/test'
  const directory = '/Users/test/.claude/ideas'
  expect(ideasFileOf('/Users/test/Projects/app', home, directory)).toBe(`${directory}/home/Projects/app.md`)
  expect(ideasFileOf('/Users/test/Projects/app/', home, directory)).toBe(`${directory}/home/Projects/app.md`)
  expect(ideasFileOf('/Users/test', home, directory)).toBe(`${directory}/home.md`)
  expect(ideasFileOf('/Users/tester/app', home, directory)).toBe(`${directory}/root/Users/tester/app.md`)
  expect(ideasFileOf('/opt/tools', home, directory)).toBe(`${directory}/root/opt/tools.md`)
  expect(ideasFileOf('/', home, directory)).toBe(`${directory}/root.md`)
  expect(ideasFileOf('C:\\Users\\test\\app', 'C:\\Users\\test', directory)).toBe(`${directory}/home/app.md`)
})

test('the list shows the first line, the tool numbers every line', async () => {
  expect(previewOf('one line')).toBe('one line')
  expect(previewOf('title\ndetails')).toBe('title …')
  expect(numberedList(['a', 'b\nc'])).toBe('1. a\n2. b\n   c')
})
