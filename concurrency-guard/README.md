# concurrency-guard

Caps how many subagents and monitors Claude runs at the same time. Parallel subagents multiply token use, and a runaway loop can start dozens of monitors; this mod makes going beyond a limit a deliberate decision.

| Situation | What happens |
| --- | --- |
| Below the limit | The subagent or monitor starts as usual |
| At the limit, no reason given | The start is refused; Claude is told how to retry with a reason, and to do so only if another one in parallel is really necessary |
| At the limit, reason given | A dialog shows the task and Claude's reason: **Allow once**, **No limit this session** or **Deny** |
| Your prompt names a count | "Use 8 subagents", "starte fünf Subagents", "5 monitors" raises the limit to that count for the session; a toast confirms it |

While anything runs, the footer under the prompt shows the count against the limit, for example `🤖 2/4 👁 1/3` for subagents and monitors. A kind with nothing running is left out.

Several subagents started in one message are decided one after another, and a subagent that was let through counts until it is visibly running — otherwise all of them would see an empty slot at the same moment.

## Configuration

| Option | Default |
| --- | --- |
| `maxSubagents` | 4 |
| `maxMonitors` | 3 |

Change them in `/config`, or in `~/.claude/settings.json`:

```json
"pluginConfigs": {
  "concurrency-guard": { "options": { "maxSubagents": 6, "maxMonitors": 2 } }
}
```

## How Claude states a reason

Claude learns the format from the refusal, so nothing has to be configured. For reference: a subagent carries the reason as the first line of its prompt, a monitor in front of its description, each introduced with `Over-limit reason:`. The mod removes the reason again before the subagent or monitor starts.

## Details and limits

- Counts in prompts are read in English and German, as digits or as words up to twelve, when they stand directly before "subagents", "agents" or "monitors". Raising only ever goes up; `/clear` resets the limits.
- Only typed prompts raise limits. Messages from subagents, other sessions or task notifications never do.
- Running subagents come from Claude Code itself. Monitors are counted by the mod from their start until `TaskStop`, their timeout or their end notification; a monitor started before the mod was loaded is not counted.
- Only starts through Claude's Agent tool are gated. Subagents that workflows or other plugins start are not stopped, but they count toward the running total.

## Uninstall

Remove the mod from `CLAUDE_CODE_PLUGIN_DIRS`. Its options in `pluginConfigs` can be deleted.
