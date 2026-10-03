# service-radar

Keeps track of services Claude starts in the background and that keep running after the command returned — a Docker Compose stack, a container, the Colima VM, a Homebrew service — and lets you stop them.

Claude Code already lists its own background shells and subagents. What it does not show is a service that detaches: `docker compose up -d` returns at once, and the stack keeps running unnoticed. This mod fills that gap and stays out of sight otherwise.

| When | What you see |
| --- | --- |
| Nothing Claude started is running | nothing |
| Something is running | one status line entry, `services 2` |
| You want details | `/services` opens a pane: name, folder, start time, a **Stop** button per service, **Stop all**, **Refresh** |
| `/clear` while something runs | a dialog listing the services: **Stop all** or **Keep running** |
| A new session starts while services from an earlier one still run | a toast pointing to `/services` |

No setup needed.

## What is tracked

| Started with | Stopped with | Running check |
| --- | --- | --- |
| `docker compose up -d` (also `docker-compose`) | `docker compose down` in the same folder, with the same `-f`, `-p` and `--profile` flags | `docker compose ps` |
| `docker run -d` | `docker stop <name or id>` | `docker ps` |
| `colima start [profile]` | `colima stop [profile]` | `colima status` |
| `brew services start` / `run` / `restart` | `brew services stop` | `brew services info --json` |
| `launchctl load` | `launchctl unload` | none — shown with `?` and a **Forget** button |

Services are matched in chained commands too, including a preceding `cd`: in `cd app && docker compose up -d` the stack is tracked in `app`. A service that was stopped some other way — by you in a terminal, or by Claude running the stop command — drops off the list the next time it is checked.

## Details and limits

- The list is kept across sessions, because services outlive them. Exiting Claude Code cannot show a dialog, so the next session reminds you instead.
- Only commands Claude runs through its Bash tool are seen. Services you start yourself are not listed.
- Processes sent to the background with `&` or `nohup` are not tracked; use Claude Code's background shells for those, which it lists and stops itself.
- Checks run with a 20-second timeout and never delay the start of a session.

## Uninstall

Remove the mod from `CLAUDE_CODE_PLUGIN_DIRS`. Services it tracked keep running; stop them first with `/services` if you want them gone.
