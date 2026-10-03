# machine-guard

Stops Claude from changing your machine behind your back. Before a command that installs software, needs root, starts services or edits global configuration runs, a dialog shows you the command and the reason it was caught:

```
Claude wants to run a command that changes this machine (brew install changes installed packages):

  brew install jq

Allow it?
  ❯ Allow once
    Deny
```

**Allow once** runs it. **Deny** refuses it, and Claude is told to give you the command instead. Typing your own answer, such as "use mise instead", refuses it and passes your words to Claude.

The dialog is shown to you directly, also in auto mode. A regular permission "ask" would be settled by auto mode's own reviewer, which may approve it without you.

No setup needed.

## What is caught

| Caught | Let through |
| --- | --- |
| `sudo`, `curl … \| sh` | read-only commands such as `brew list`, `docker ps` |
| `brew install`, `upgrade`, `uninstall`, `tap`, `services start`, `bundle` | project dependencies: `npm install`, `npm ci`, `pnpm install` |
| global `npm`, `pnpm`, `yarn`, `bun` installs | `pip` inside a virtual environment (`.venv/bin/pip`) |
| `pip` outside a virtual environment, `pipx`, `uv tool`, `cargo install`, `go install`, `gem install`, `dotnet tool install -g` | stopping things: `colima stop`, `brew services stop` |
| `mise install` and `use`, `asdf`, `rustup` | `git config` without `--global` |
| `colima start`, `docker run`, `pull`, `build`, `docker compose up`, `launchctl load` | |
| `defaults write`, writing `git config --global`, `xcode-select --install`, `softwareupdate`, `winget`, `choco`, `scoop` | |

Chained commands are checked part by part: in `cd app && brew install jq` the second part is caught.

## Per-project rules

An optional `.claude/machine-guard.json` in a project adds rules for that project. `match` is a regular expression tested against each part of a command.

```json
{
  "ask": [
    { "match": "^dotnet (run|watch)\\b", "reason": "Starts a local instance without data" }
  ],
  "block": [
    { "match": "^rm -rf\\b", "reason": "Never delete recursively in this project" }
  ]
}
```

| Level | Effect |
| --- | --- |
| built in | the dialog for the commands in the table above, in every project |
| `ask` | the dialog with `reason` shown, also for commands the built-in rules let through |
| `block` | refused without a dialog; Claude receives `reason` |

A command caught by a built-in rule and an `ask` rule shows one dialog with both reasons.

## Limits

The guard recognises commands, not intentions. An installer it does not know, a script such as `bash install.sh` that installs internally, or a file Claude writes outside the project with its Write tool are not caught. Keep an instruction in your `CLAUDE.md` that Claude must not install anything unasked; the guard is the safety net under it.

It errs the other way too: `brew install` inside a heredoc that only writes documentation shows the dialog.

## Uninstall

Remove the mod from `CLAUDE_CODE_PLUGIN_DIRS`. Project files `.claude/machine-guard.json` are ignored without it.
