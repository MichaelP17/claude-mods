# cache-watch

Shows how long the prompt cache stays warm and suggests compacting a large context at the moments where it pays off.

Every model request re-sends the whole conversation. The prompt cache makes that cheap, but it expires a fixed time after the last request — one hour in Claude Code, five minutes under usage overage. A request on an expired cache re-reads the entire context at the cache write price, which on a large context is the most expensive single request of a session. This mod keeps that moment visible and offers to shrink the context before it happens.

## Countdown

| Shown | Meaning |
| --- | --- |
| `⏳ 42m` | Warm for another 42 minutes |
| `⏳ 8m`, yellow | Expires within `warnMinutes` |
| `🧊 cold` | Expired; the next request rebuilds the cache over the whole context |

The countdown sits in the footer under the prompt: beside the model picker in the desktop app, among the mode labels in the terminal. It shares that footer with [`status-band`](../status-band/README.md) and [`idea-shell`](../idea-shell/README.md).

It only appears when there is something to decide: from `statusFromTokens` of context on, or while the cache is about to expire. A small context on a cold cache shows nothing, and neither does the time right after a compaction, when the next request rebuilds the cache anyway.

The timer starts over with every model request of the main conversation, including the steps Claude takes on its own between tool calls. Subagents have a cache of their own and do not count.

## Suggestions

From `largeContextTokens` of context on, a band above the prompt offers **Compact**, **Write handoff** and **Dismiss**:

| When | Why then |
| --- | --- |
| The cache expires in `warnMinutes` and you are idle | Compacting on a warm cache reads the context at the cache read price |
| A turn committed or ran tests green | A unit of work ended; nothing in flight gets lost |

A running turn is never interrupted.

**Write handoff** sends a prompt that asks Claude to write `HANDOFF.md` at the repository root: goal, state, decisions with their reasons, rejected approaches, open points and the exact next step.

When a conversation starts in a repository that has a `HANDOFF.md`, a toast names it and Claude is told where it lies, so asking it to continue is enough for the next session. Only the path is added to the context, not the file's content.

When you send a prompt on a cold cache with a large context, a dialog asks whether to compact first. The rebuild is paid either way; compacting first pays it on the smaller remainder.

## Lifetime learned from the server

The server reports with every response how much of the prompt came from the cache. When a request finds nothing cached although the timer still ran, the mod switches to a five-minute lifetime; when a request is served from the cache after more than five minutes, it switches back. Prompts under 20k tokens teach nothing, since they may be too short to be cached at all.

## Configuration

| Option | Default | Meaning |
| --- | --- | --- |
| `ttlMinutes` | 60 | Cache lifetime Claude Code uses |
| `warnMinutes` | 10 | How early before expiry to suggest compacting |
| `statusFromTokens` | 300000 | Context size from which the countdown shows |
| `largeContextTokens` | 300000 | Context size from which the mod suggests compacting |

Change them in `/config`, or in `~/.claude/settings.json` under `pluginConfigs["cache-watch"].options`.

## Works with compact-shaper

**Compact** runs a normal compaction. With [`compact-shaper`](../compact-shaper/README.md) loaded, its summary follows the structure of a handoff.

## Uninstall

Remove the mod from `CLAUDE_CODE_PLUGIN_DIRS`. Its options in `pluginConfigs` can be deleted.
