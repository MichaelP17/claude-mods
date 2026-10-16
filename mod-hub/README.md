# mod-hub

Gathers the mods in one place in the desktop app. The footer under the prompt has room for little more than the usage line, and a slash command typed while Claude works waits there until the turn ends. mod-hub puts a single 🧰 button in the footer instead of one label per mod; a click opens a pane at once, also while Claude is working.

| When | What you see |
| --- | --- |
| Always, in the desktop app | 🧰 at the left of the footer, the usage line of `status-band` beside it |
| A mod reports something that needs attention | a count on the button, `🧰 2`, yellow when something is urgent, such as the cache about to expire |
| Click on 🧰, or `/hub` | the Mods pane: one card per mod with its icon, its status and its actions, the mods that need a look first |
| Click on an action | the mod does it, usually opening its own pane, and the hub closes |

| Mod | Status | Actions |
| --- | --- | --- |
| `idea-shell` | ideas for this folder | **Open** |
| `service-radar` | services running | **Open** |
| `grill-panel` | answered questions of the open round | **Continue**, or **Latest round** |
| `cache-watch` | how long the cache stays warm, the context size | **Compact now** between turns, when compacting pays off |
| `session-relay` | channel and role, waiting tasks or answers | **Open** |
| `concurrency-guard` | subagents and monitors running | — |
| `config-snapshots` | whether the config changed since the last snapshot | **Open** |

With mod-hub loaded, those mods leave the desktop footer to it; without it they draw their own labels there, as before. The terminal is unchanged: its footer keeps the mods' labels and the slash commands run at once. `/hub` opens the pane there too.

No setup needed.

## For mod authors

mod-hub adds `$.hub` to every mod's `$`. A mod reports its row with `$.hub.set({ id, icon, title, status, attention, actions })` whenever it changes, `attention` being `none`, `info` or `warning`; a later `set` with the same `id` replaces the row, `$.hub.remove({ id })` drops it. A press on an action raises `ui.press` for the element `<id>:<action key>` of `mod-hub`, which the mod answers with `on('ui.press', { plugin: 'mod-hub', element: 'my-mod:open' }, ...)`.

The mods here do not list mod-hub under `dependencies`, since a mod with a missing dependency does not load at all. They call `$.hub` through a cast and catch the error a session without mod-hub raises.

## Uninstall

Remove the mod from `CLAUDE_CODE_PLUGIN_DIRS`. The other mods draw their own footer labels again.
