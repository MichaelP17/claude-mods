# status-band

Shows the status line's figures in the desktop app, where Claude Code has no status line. A band above the prompt carries what a terminal status line usually shows.

In the terminal the band stays empty, so an existing status line is not duplicated.

## What it shows

| Part | Example | Meaning |
| --- | --- | --- |
| Model | `Opus 5.5` | The main conversation's model |
| Mode | `plan fast` | Permission mode other than default, fast mode, thinking switched off, a non-default output style, an `--agent` agent |
| Directory | `~/Projects/app` | The session's working directory |
| Git | `⎇ main ●2 ?1 ↑1` | Branch, `@worktree` for a linked worktree, changed and untracked files, commits ahead and behind; `✓` when clean |
| Context | `████░░░░░░ 42%` | How full the context window is; yellow from 60%, red from 85% |
| Rate limit | `5h 23% ↻ 14:00` | Use of the five-hour window and when it resets |
| Cost | `$1.50 12m` | What the session has cost and how long it has run |

A second line repeats the status lines other mods pin under the terminal prompt (`cache 42m · ctx 250k`, `services 1`), so they reach the desktop too. A band another mod draws, such as the compaction suggestion of `cache-watch`, stays visible below.

The band wraps instead of dropping parts when the window is narrow.

## When it updates

After every tool call and turn, on a model switch, a directory change or a settings change, when the desktop app connects, and every 30 seconds. Git is read at most every five seconds, and after every turn.

The permission mode is read when a prompt is sent and when a turn ends, so a mode switch while idle shows with the next prompt.
