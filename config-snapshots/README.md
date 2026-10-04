# config-snapshots

Puts `~/.claude` under version control, so trying a plugin, mod or skill is reversible: take a snapshot, experiment, roll back if you do not like the result.

It consists of a shell script, `bin/claude-config`, and a mod that exposes the script inside Claude Code. Both do the same thing; use whichever is at hand.

## What a snapshot holds

The snapshot repository is a bare git repository at `~/.claude-config.git` whose work tree is `~/.claude`. Nothing inside `~/.claude` changes except one file, `~/.claude/.gitignore`, which is an allowlist: everything is ignored unless listed.

| Recorded | Not recorded |
| --- | --- |
| `settings.json`, `CLAUDE.md`, `rules/`, `skills/`, `agents/`, `commands/`, `hooks/`, `keybindings.json`, `statusline.py` | transcripts (`projects/`), `history.jsonl`, caches, sessions |
| `plugins/installed_plugins.json`, `plugins/known_marketplaces.json` | plugin caches and marketplace clones |
| `inventory/<machine>/` | |

`inventory/<machine>/` lists what is installed on the machine at snapshot time: Homebrew (`Brewfile`), global `npm`, `cargo`, `mise`, `dotnet tool`, `uv tool`, `pipx` and `winget` packages — each only if the tool exists — the MCP servers from `~/.claude.json`, and the commit of every mod loaded through `CLAUDE_CODE_PLUGIN_DIRS`. Each machine writes only its own folder, so several machines can share one snapshot repository.

## Setup

1. Initialise the repository and record the first snapshot, `baseline`. Pass a remote URL to push snapshots there (an empty, private repository is the right target):

   ```sh
   ~/claude-mods/config-snapshots/bin/claude-config init git@github.com:<you>/claude-config.git
   ```

   Without a URL, snapshots stay local. An existing `~/.claude/.gitignore` is kept as the allowlist.

2. Optional — use the script by name in a terminal by adding its folder to `PATH` in your shell profile:

   ```sh
   export PATH="$HOME/claude-mods/config-snapshots/bin:$PATH"
   ```

3. Optional — let Claude take snapshots and roll back without a permission prompt: run `/permissions` in Claude Code and add the allow rules `Bash(claude-config snapshot:*)` and `Bash(claude-config rollback:*)` to the user settings. This needs step 2.

To keep the repository elsewhere, set `CLAUDE_CONFIG_GIT_DIR` to its path — in the shell profile for the terminal, and in the `env` block of `~/.claude/settings.json` for the mod.

## Use

| Command | Effect |
| --- | --- |
| `claude-config snapshot <name> [message]` | Record the current state as `<name>`; spaces become dashes |
| `claude-config list` | All snapshots with date |
| `claude-config status` | Changes since the last snapshot, plus new entries in `~/.claude` the allowlist does not cover |
| `claude-config diff <name> [--full]` | Changed files since `<name>` and packages installed since then |
| `claude-config rollback <name>` | Restore the config of `<name>` |
| `claude-config brew-cleanup <name>` | Uninstall Homebrew packages added since `<name>`, after confirmation |
| `claude-config prune` | Delete caches of plugins and marketplaces that are no longer installed, after confirmation |

Inside Claude Code:

| Command | Effect |
| --- | --- |
| `/snapshot <name>` | Same as `claude-config snapshot` |
| `/snapshots` | A pane with all snapshots; selecting one shows its diff, a button rolls back after a second confirming press |
| `/rollback <name>` | Opens the pane on that snapshot |

At session start a toast reports when the config changed since the last snapshot.

A rollback never rewrites history: it commits the current state first, then commits the restored one, so a rollback can itself be undone. It never uninstalls packages; it lists them and leaves the decision to you. `snapshot` and `rollback` push to `origin` when a remote is set; `CLAUDE_CONFIG_NO_PUSH=1` skips the push. Restart Claude Code after a rollback.

## Limits

- MCP servers added with `claude mcp add --scope user` live in `~/.claude.json`, which also holds login data and runtime state. Only its `mcpServers` section is recorded, and a rollback reports differences there instead of rewriting the file.
- `plugins/installed_plugins.json` contains absolute paths, so plugins are best installed per machine rather than shared across operating systems.
- `lastUpdated` in `plugins/known_marketplaces.json` is not recorded, because Claude Code rewrites it on every background marketplace refresh. A rollback restores that file without the field.
- Homebrew's auto-update is disabled while the script reads the inventory; otherwise taking a snapshot could migrate formulae.

## Uninstall

Remove the mod from `CLAUDE_CODE_PLUGIN_DIRS`. The snapshot repository `~/.claude-config.git` and `~/.claude/.gitignore` stay until you delete them.
