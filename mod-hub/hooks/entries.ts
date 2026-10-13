import type { HubEntry } from '../types'

// Copied field by field, so a mod that passes more than the contract holds
// cannot grow the state.
export function entryOf(input: HubEntry): HubEntry {
  return {
    id: input.id,
    icon: input.icon,
    title: input.title,
    status: input.status,
    attention: input.attention,
    actions: input.actions.map(i => ({ key: i.key, label: i.label })),
  }
}

export function upsert(list: readonly HubEntry[], entry: HubEntry): HubEntry[] {
  const index = list.findIndex(i => i.id === entry.id)

  return index === -1 ? [...list, entry] : list.map((value, position) => (position === index ? entry : value))
}

export function without(list: readonly HubEntry[], id: string): HubEntry[] {
  return list.filter(i => i.id !== id)
}

export function sorted(list: readonly HubEntry[]): HubEntry[] {
  return [...list].sort((left, right) => left.title.localeCompare(right.title))
}

export function badgeOf(list: readonly HubEntry[]): { count: number; color: string } {
  const noted = list.filter(i => i.attention !== 'none')

  return { count: noted.length, color: noted.some(i => i.attention === 'warning') ? 'warning' : 'claude' }
}
