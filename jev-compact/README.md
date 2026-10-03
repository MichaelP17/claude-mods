# jev-compact

Replaces Claude Code's compaction: instead of summarizing the conversation, it cuts tool output that can be read again. Your messages and Claude's answers stay word for word.

A summary loses what nobody wrote down — a decision's reason, a rejected approach, an exact error. Most of a long session's context, though, is tool output: file contents, test runs, search results. That part can be recovered by running the tool again, so cutting it loses little. Jev, a decision model by TypeSafe AI, judges which outputs still need to stay; it answers with probabilities instead of text and bills input only, about $0.04 per million tokens.

## Stages

Each stage only runs while the transcript is still above `targetTokens`:

| Stage | What it cuts | Cost |
| --- | --- | --- |
| Rules | Read results of files that were edited or read in full again later; the bulk of Edit and Write inputs, since the file on disk holds the current content | none, local |
| Jev | Tool outputs Jev gives a keep probability below `keepThreshold` | fractions of a cent |
| Jev, aggressive | The same at `aggressiveThreshold` | no further request |
| Native summary | Claude Code's own compaction, run over the already cut transcript | far fewer tokens than over the original |

A cut output keeps its first `keepHeadChars` characters and a note telling Claude how to get the content back. The first message and the newest `preserveRecentMessages` are never touched.

## Shadow mode first

The mod starts in `shadow` mode: on every compaction it computes what it would cut, shows the result as a toast and writes a report, then lets the native compaction run unchanged. Switch to `active` once the reports look right.

`/jev-preview` runs the same computation on the current conversation at any time, without compacting. It shows the expected size, the largest cuts and the path of the full report.

Reports land in `~/.claude/jev-compact/runs/`, one JSON file per run, with every tool call, its size, Jev's keep probability and the decision.

## What leaves the machine

Asking Jev sends the conversation to TypeSafe's API (`api.typesafe.ai`): message texts, tool inputs and a preview of each tool output, abridged to fit Jev's input limit of about 25k tokens. Before sending, the mod:

- replaces private keys, common token formats (`sk-…`, `ghp_…`, `AKIA…`, `xox…`) and `password=`/`token=`/`api_key=` values with `[redacted]`
- sends no output preview for files such as `.env`, `*.pem`, `id_rsa`, `credentials` or `secrets.*`

To keep a project's conversations local, add `.claude/jev-compact.json` to it:

```json
{ "enabled": false }
```

The local rules still run there. Without an API key, only the local rules run everywhere.

## Configuration

| Option | Default | Meaning |
| --- | --- | --- |
| `mode` | `shadow` | `shadow` reports only, `active` replaces the native compaction |
| `apiKey` | — | TypeSafe API key, kept in secure storage; `TYPESAFE_API_KEY` in the environment works as well |
| `targetTokens` | 150000 | Size the stages aim for |
| `keepThreshold` | 0.5 | Keep probability from which an output stays |
| `aggressiveThreshold` | 0.75 | Threshold used when the normal one misses the target |
| `preserveRecentMessages` | 6 | Newest messages that are never cut |
| `previewChars` | 300 | How much of each output Jev sees; 0 sends none |
| `keepHeadChars` | 300 | How much of a cut output stays |

Set the API key in `/config`, so it lands in secure storage rather than in `settings.json`.

## Details and limits

- Only the main conversation is compacted this way; subagents keep the native compaction.
- An active compaction that saves less than 10% falls back to the native summary over the cut transcript.
- Sizes after cutting are estimates, scaled from the character count against the token count Claude Code reports.
- Claude Code's own automatic compaction triggers this mod as well; it decides when, this mod decides how.

## Uninstall

Remove the mod from `CLAUDE_CODE_PLUGIN_DIRS`. Delete `~/.claude/jev-compact/` for the reports, and the options in `pluginConfigs`.
