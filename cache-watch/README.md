# cache-watch

Shows how long the prompt cache stays warm and suggests compacting a large context at the moments where it pays off.

Every model request re-sends the whole conversation. The prompt cache makes that cheap, but it expires a fixed time after the last request — one hour in Claude Code, five minutes under usage overage. A request on an expired cache re-reads the entire context at the cache write price, which on a large context is the most expensive single request of a session. This mod keeps that moment visible and offers to shrink the context before it happens.

## Status line

| Line | Meaning |
| --- | --- |
| `cache 42m · ctx 250k` | Warm for another 42 minutes; the last request carried 250k tokens |
| `cache cold · ctx 250k` | Expired; the next request rebuilds the cache over the whole context |
| `cache rebuilds · ctx 90k` | A compaction just ran; the next request writes the cache for the smaller context |

The line only appears when there is something to decide: from `statusFromTokens` of context on, or while the cache is about to expire. A small context on a cold cache shows nothing.

The timer starts over with every model request of the main conversation, including the steps Claude takes on its own between tool calls. Subagents have a cache of their own and do not count.

## Suggestions

From `largeContextTokens` of context on, a band above the prompt offers **Compact**, **Write handoff** and **Dismiss**:

| When | Why then |
| --- | --- |
| The cache expires in `warnMinutes` and you are idle | Compacting on a warm cache reads the context at the cache read price |
| A turn committed or ran tests green | A unit of work ended; nothing in flight gets lost |

A running turn is never interrupted.

**Write handoff** puts a prompt into the input box that asks Claude to update the project's `HANDOFF.md`; you send it yourself.

When you send a prompt on a cold cache with a large context, a dialog asks whether to compact first. The rebuild is paid either way; compacting first pays it on the smaller remainder.

## Lifetime learned from the server

The server reports with every response how much of the prompt came from the cache. When a request finds nothing cached although the timer still ran, the mod switches to a five-minute lifetime; when a request is served from the cache after more than five minutes, it switches back. Prompts under 20k tokens teach nothing, since they may be too short to be cached at all.

## Configuration

| Option | Default | Meaning |
| --- | --- | --- |
| `ttlMinutes` | 60 | Cache lifetime Claude Code uses |
| `warnMinutes` | 10 | How early before expiry to suggest compacting |
| `statusFromTokens` | 300000 | Context size from which the status line shows |
| `largeContextTokens` | 300000 | Context size from which the mod suggests compacting |

Change them in `/config`, or in `~/.claude/settings.json` under `pluginConfigs["cache-watch"].options`.

## Works with jev-compact

**Compact** runs a normal compaction. With [`jev-compact`](../jev-compact/README.md) loaded, that compaction cuts re-readable tool output instead of summarizing.

## Uninstall

Remove the mod from `CLAUDE_CODE_PLUGIN_DIRS`. Its options in `pluginConfigs` can be deleted.
