# session-relay

Passes prompts from a planning session to the session that does the work, and its answers back, without copy and paste.

One session plans and writes the prompts, the **lead**. Another one carries them out, the **worker**. Without this mod every prompt and every report travels through the clipboard, and text copied out of the fullscreen terminal loses characters at its line ends: a prompt arrives with "the real foed" where "the real footage" was written. Here both directions are a press, and the text arrives as it was written.

## Setup

| Where | Command |
| --- | --- |
| The lead's folder | `/relay lead <channel>` |
| The worker's folder | `/relay worker [channel]`; without a name the folder's name, `clued` for `~/Projects/Clued` |

Each folder remembers its role: every later session started there joins the channel by itself, `/clear` included. `/relay off` ends that.

## What you see

| When | Where | What |
| --- | --- | --- |
| The lead's answer holds a prompt in a fenced block | lead, band above the prompt | **Send**, **Send as fresh session**, **Other block** when there are several, **View**, **Dismiss** |
| A task arrived | worker, band | **Clear & send** runs `/clear` first, **Send here** goes into the running conversation; the one the lead chose is the primary button. **View**, **Discard** |
| The worker finished a turn | lead, toast, notification and band | **Attach to next prompt**, **Forward now**, **View**, **Discard** |
| A session is linked | status line | lead `⇄ clued · working 12m · 1 answer waiting`, worker `⇄ clued · worker · task waiting` |

**Attach to next prompt** sends the answers along with the next prompt you type in the lead, as context the model reads beside it: you type only your feedback. **Forward now** sends them at once as your message.

A fenced block counts as a prompt from 300 characters on, when it has no language or is tagged `text`, `markdown` or `prompt`. Blocks tagged `bash`, `json` and the like are code to read and never offered.

| Command | Effect |
| --- | --- |
| `/relay` | A pane with everything pending in full, and the actions |
| `/relay send [text]` | Sends the text as typed; without text the last fenced block of the last answer |
| `/relay off` | Leaves the channel; this folder no longer joins it |

## Nothing reaches a model without a press

A task waits in the worker until you press **Clear & send** or **Send here** there, and an answer waits in the lead until you attach or forward it. The relay travels through files any process of yours can write; the press in the session itself is what makes the text your prompt. The worker then reads the task as your own words.

## How it travels

Everything lives under `~/.claude/relay/<channel>/`: one JSON file per task in `to-worker/`, one per answer in `to-lead/`, and `worker.json`, which names the worker session, whether it is working, and a heartbeat every 30 seconds. Each linked session looks every two seconds.

So it works between the terminal and the desktop app alike, and nothing is lost while a session is closed: an answer that arrives at night waits in the lead's band the next morning, and a task sent to a worker nobody has opened yet is there when it opens.

## Details and limits

- The worker is the session in the worker folder used last: a prompt there takes the slot over. A second session in the same folder shows *another session is the worker* and a **Take over** button.
- Every finished turn of the worker goes back, not only the ones a task started: an answer to a question typed in the worker belongs to the work as well. The lead keeps the last ten answers, each cut at 100,000 characters.
- Only the final text of a worker turn travels; text Claude wrote between tool calls stays in the worker.
- The offer belongs to the answer that just ended: typing a prompt in the lead drops it. `/relay send` takes the last block later.
- A new task replaces one the worker has not picked up yet; the toast says so.
- One worker and any number of leads per channel. A channel name is letters, digits, dots, dashes and underscores.
- The notification goes through Claude Code's notification channel and is skipped where there is none; the toast always shows.
- The mobile app draws no band; `/relay` opens the pane there.

## Configuration

| Option | Default | Meaning |
| --- | --- | --- |
| `minPromptChars` | 300 | Shortest fenced block offered as a prompt |
| `notify` | `true` | Raise a notification in the lead when an answer arrives |

Change them in `/config`, or in `~/.claude/settings.json` under `pluginConfigs["session-relay"].options`.

## Uninstall

Remove the mod from `CLAUDE_CODE_PLUGIN_DIRS`. Pending tasks and answers stay in `~/.claude/relay/` until you delete it.
