import { expect, test } from 'claude-code/testing'

import type { HubEntry } from '../types'
import { badgeOf, entryOf, sorted, upsert, without } from './entries'

const IDEAS: HubEntry = { id: 'idea-shell', icon: '💡', title: 'Ideas', status: '3', attention: 'none', actions: [] }
const GRILL: HubEntry = { id: 'grill-panel', icon: '🔥', title: 'Grill', status: '2/5', attention: 'info', actions: [] }
const CACHE: HubEntry = { id: 'cache-watch', icon: '⏳', title: 'Cache', status: '4m', attention: 'warning', actions: [] }

test('a mod setting its entry again replaces it in place', async () => {
  const list = upsert(upsert([], IDEAS), GRILL)
  expect(upsert(list, { ...IDEAS, status: '4' }).map(i => [i.id, i.status])).toEqual([
    ['idea-shell', '4'],
    ['grill-panel', '2/5'],
  ])
  expect(without(list, 'idea-shell')).toEqual([GRILL])
})

test('the list is sorted by title, and the badge counts what needs attention', async () => {
  expect(sorted([IDEAS, GRILL, CACHE]).map(i => i.title)).toEqual(['Cache', 'Grill', 'Ideas'])
  expect(badgeOf([IDEAS])).toEqual({ count: 0, color: 'claude' })
  expect(badgeOf([IDEAS, GRILL])).toEqual({ count: 1, color: 'claude' })
  expect(badgeOf([IDEAS, GRILL, CACHE])).toEqual({ count: 2, color: 'warning' })
})

test('an entry keeps only the fields the contract names', async () => {
  const loose = { ...IDEAS, extra: 'x', actions: [{ key: 'open', label: 'Open', more: 1 }] }
  expect(entryOf(loose)).toEqual({ ...IDEAS, actions: [{ key: 'open', label: 'Open' }] })
})
