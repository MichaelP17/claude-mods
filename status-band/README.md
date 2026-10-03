# status-band

Shows context and usage limits in the desktop app, where Claude Code has no status line. One short line sits in the footer under the prompt, beside the app's model and effort pickers:

```
C 10% · 5h 74% · W 98%
```

| Part | Meaning |
| --- | --- |
| `C` | How full the context window is |
| `5h` | Use of the five-hour rate-limit window |
| `W` | Use of the weekly rate-limit window |

Each value is green below 60%, yellow from 60% and red from 85%. A window without a reading, as off a subscription, is left out. Mode labels the app shows in the same footer stay in front.

Mode, folder, model and effort are not repeated: the app's own controls already show them. In the terminal the mod draws nothing, so an existing status line is not duplicated.

## When it updates

After every tool call and turn, when the desktop app connects, and every 30 seconds.
