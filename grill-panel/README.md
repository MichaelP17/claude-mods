# grill-panel

Answers Claude's question rounds one question at a time. When Claude ends a turn with numbered questions — the `❓ **Q1** - **Title**: …` / `➡️ recommendation` format of the grilling skill — a panel opens beside the conversation with a text field for the first open question. Enter saves the answer and moves on; once every question has an answer, a review lets you change any of them or send them all to Claude as `Q1: …` lines.

| When | What you see |
| --- | --- |
| Claude's answer ends on a question round | the panel opens on the first open question; `🔥 0/5` in the footer under the prompt counts the answered questions |
| Enter in the field | the answer is saved, the next open question comes up |
| Enter on an empty field | the question's recommendation is taken (`Q2: Recommendation accepted`) |
| **Edit recommendation** | the recommendation's text goes into the field to change before Enter |
| Shift+Tab, then Enter | back to the previous question |
| **Skip ▶** | the question stays open and comes back after the others |
| Every question answered | the review: a digit opens that answer again, Enter sends |
| **Send…** with questions still open | asks first, then sends the open ones as `Q4: (unanswered)` |
| **Discard round** | asks first, then closes the round for good; `/grill` brings it back |
| Esc, or the pane's close mark | the panel closes, the answers stay; `/grill` reopens it |

The answers reach Claude as one message of yours. Until you send, nothing you type in the panel reaches Claude.

No setup needed. Works in the terminal, the desktop app and VS Code; the mobile app draws no text field and says so.

## Format

The panel reads the format the grilling skill asks for, and tolerates the drift a model falls into: `**Q2 (updated)**`, a missing `❓`, `–` or `:` as separators, a question without a recommendation. A bold `**Q3**` in ordinary prose is not a round: one question needs the `❓` or a `➡️` recommendation.

Whenever the `grilling` skill loads, the mod appends a short paragraph to the prompt the model reads, pinning that format and explaining what `Recommendation accepted` and `(unanswered)` mean. The skill's own file is left alone, so updating the skill from upstream loses nothing.

## Where answers are kept

Each answer confirmed with Enter is saved at once in the mod's store under `~/.claude`, per project and question round. Starting Claude Code again with `--continue` or `--resume`, or `/resume` in a running session, brings the round back with its answers when the conversation still ends on it. A round you sent or discarded is not offered again; entries untouched for 30 days are dropped at the next start.

## Details and limits

- The panel opens by itself as a side pane when the terminal runs fullscreen and is at least 144 columns wide (110 once you opened it yourself with `/grill`); otherwise a toast points to `/grill`, which opens it at any width. The desktop app always opens it as a side pane.
- It takes the keyboard when it opens only while the prompt box is empty; otherwise click into the field.
- The desktop app's text field is a single line.
- Typing an ordinary prompt while a round is open leaves the round alone, so you can ask Claude about a question before answering it. A new round from Claude replaces the old one.
- Only Claude's final text of a turn is read, never a subagent's.

## Uninstall

Remove the mod from `CLAUDE_CODE_PLUGIN_DIRS`. The saved answers live in the mod's store and expire after 30 days.
