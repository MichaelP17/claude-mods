# idea-shell

Captures ideas while Claude is busy, without interrupting it. Type `/idea` mid-turn, write the thought down, and Claude keeps working on its task; later you hand the idea to Claude or let it work through the list.

Ideas belong to the folder Claude Code was started in. Every folder has its own list, whether it is a git repository or not.

| When | What you see |
| --- | --- |
| `/idea <text>`, also while Claude is working | the idea is saved, a toast confirms it; Claude sees nothing |
| `/idea` | a pane with one text field: Enter saves and empties it for the next idea, Shift+Enter adds a line in the terminal, Esc closes |
| Ideas exist for this folder | `💡 3` in the footer under the prompt, terminal and desktop app |
| `/ideas` | a pane listing the folder's ideas: pressing one puts it into the prompt and removes it from the list, **delete** drops it |
| You ask Claude to work through the ideas | Claude reads them with its `ideas_list` tool and removes each with `idea_remove` once it is done |

No setup needed.

## Where ideas are kept

One Markdown file per folder under `~/.claude/ideas/`, mirroring the folder's path: ideas for `~/Projects/app` live in `~/.claude/ideas/home/Projects/app.md`, ideas for a folder outside your home directory under `~/.claude/ideas/root/…`. A file holds nothing but the ideas, one bullet each, so reading it costs Claude only the ideas themselves. The file is deleted when its last idea is gone.

`config-snapshots` records `~/.claude/ideas/` with every snapshot, which carries the ideas to other machines that share the snapshot repository.

## Details and limits

- `/idea` runs immediately, even while a turn is in flight, and leaves no row in the conversation: neither the command nor the idea reaches Claude's context.
- `/ideas` waits for the turn to end, since handing an idea to Claude only makes sense once it is free.
- The folder is the one the session started in; a `cd` inside a shell command does not change it, `/cd` does. A subfolder or a worktree has a list of its own.
- Every change re-reads the file first, so two sessions in the same folder do not overwrite each other's ideas.
- The desktop app's text field is a single line: Shift+Enter saves there like Enter.
- The mobile app draws no text field; `/idea <text>` works there.

## Uninstall

Remove the mod from `CLAUDE_CODE_PLUGIN_DIRS`. Captured ideas stay in `~/.claude/ideas/` until you delete them.
