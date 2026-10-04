# compact-shaper

Shapes Claude Code's compaction. A normal compaction is summarized as a handoff; `/compact prune` cuts tool output that can be read again instead, and keeps every message word for word.

## Two ways to compact

| Command | What happens | When it fits |
| --- | --- | --- |
| `/compact` | Claude Code's own summary, written along the structure of a handoff: goal, state, decisions and their reasons, rejected approaches, open points, next step, files to read first. Text after `/compact` is added to that structure | Several topics in, or the context is large; the summary is far smaller than anything a cut leaves |
| `/compact prune` | Long tool outputs are cut to their head and a note on how to get them back; messages stay exactly as written | In the middle of a task, when the exact thread of the conversation matters more than the size |

The automatic compaction takes the first path. Subagents keep the native compaction unchanged.

`/prune-preview` shows what `/compact prune` would cut, without changing anything.

The handoff-shaped summary stays inside the session; it writes no `HANDOFF.md`. For a break between tasks, or to continue on another device, a written handoff and `/clear` beat both: [`cache-watch`](../cache-watch/README.md) offers that at the right moments.

## What `/compact prune` cuts

Every tool output longer than `keepHeadChars` + 200 characters, outside the first and the newest `preserveRecentMessages` messages, keeps its first `keepHeadChars` characters. Read results of a file that was later edited or read again in full count as superseded and are cut the same way. Edit and Write inputs shrink to their head, since the file on disk holds the current content.

Protected, because they cannot simply be produced again:

- results of subagents (`Agent`, `Task`)
- failed tool calls
- `git status`, `git stash list`, `gh run view` and `gh pr checks`: snapshots of a state that has moved on, and CI logs that expire

A cut that saves less than 10% is skipped and leaves the conversation unchanged.

## Configuration

| Option | Default | Meaning |
| --- | --- | --- |
| `preserveRecentMessages` | 6 | Newest messages that are never cut |
| `keepHeadChars` | 300 | How much of a cut output stays |

Change them in `/config`, or in `~/.claude/settings.json` under `pluginConfigs["compact-shaper"].options`.

