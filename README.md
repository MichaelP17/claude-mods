# claude-mods

Mods for [Claude Code](https://code.claude.com): small plugins of function hooks that run inside Claude Code itself. They add guard rails, slash commands and panes without involving the model, so they cost no tokens.

| Mod | What it does |
| --- | --- |
| [`config-snapshots`](config-snapshots/README.md) | Versions `~/.claude` in git: named snapshots, diffs and rollbacks, from the terminal or with `/snapshot`, `/snapshots` and `/rollback` |
| [`machine-guard`](machine-guard/README.md) | Asks you before Claude runs a command that changes your machine — installs, `sudo`, services, global config |
| [`concurrency-guard`](concurrency-guard/README.md) | Caps how many subagents and monitors run at the same time; more need a stated reason and your approval |
| [`service-radar`](service-radar/README.md) | Tracks services Claude starts detached — Docker Compose stacks, containers, Colima, Homebrew services — and stops them on request or at `/clear` |
| [`cache-watch`](cache-watch/README.md) | Shows how long the prompt cache stays warm and suggests compacting a large context before it goes cold or after a milestone |
| [`jev-compact`](jev-compact/README.md) | Compacts by cutting re-readable tool output instead of summarizing; local rules plus TypeSafe's Jev model decide what stays |
| [`status-band`](status-band/README.md) | Shows the status line's figures — model, git, context, rate limit, cost — as a band above the prompt in the desktop app |

Each mod is independent. Install only the ones you want.

## Requirements

- Claude Code with mod support (built and tested with 2.1.288)
- macOS or Linux. Windows works through Git Bash for the hooks, but is untested
- `config-snapshots` additionally needs `bash`, `git` and `jq`

Nothing has to be built or installed with a package manager: Claude Code loads the TypeScript sources directly.

## Installation

Claude Code loads mods from the folders listed in the environment variable `CLAUDE_CODE_PLUGIN_DIRS`, set in the `env` block of `~/.claude/settings.json`. Every mod is one folder of this repository.

1. **Clone the repository** to a permanent location — the mods are loaded from there, so do not delete the folder afterwards.

   ```sh
   git clone https://github.com/MichaelP17/claude-mods.git ~/claude-mods
   ```

2. **Back up your settings.**

   ```sh
   cp ~/.claude/settings.json ~/.claude/settings.json.backup
   ```

3. **Add the mod folders to `CLAUDE_CODE_PLUGIN_DIRS`.** Use absolute paths, separated by `:` (on Windows `;`). Keep every entry that is already there. This command appends all seven mods and creates the `env` block if it is missing; remove the ones you do not want from `MODS`:

   ```sh
   MODS="$HOME/claude-mods/config-snapshots:$HOME/claude-mods/machine-guard:$HOME/claude-mods/concurrency-guard:$HOME/claude-mods/service-radar:$HOME/claude-mods/cache-watch:$HOME/claude-mods/jev-compact:$HOME/claude-mods/status-band"
   jq --arg mods "$MODS" '.env.CLAUDE_CODE_PLUGIN_DIRS = (if (.env.CLAUDE_CODE_PLUGIN_DIRS // "") == "" then $mods else .env.CLAUDE_CODE_PLUGIN_DIRS + ":" + $mods end)' \
     ~/.claude/settings.json > /tmp/settings.json && mv /tmp/settings.json ~/.claude/settings.json
   ```

   If `~/.claude/settings.json` does not exist yet, create it with `{}` first.

4. **Run the mod-specific setup** described in each mod's README. `config-snapshots` needs `claude-config init`; `jev-compact` needs an OpenRouter or TypeSafe API key in the environment for Jev and runs on local rules alone without one.

5. **Restart Claude Code.** Mods are loaded at startup. The desktop app reads the same `env` block, so the mods load there too once it is restarted.

6. **Check that they loaded:** typing `/` lists `/snapshot`, `/snapshots` and `/rollback` when `config-snapshots` is active, and `/jev-preview` when `jev-compact` is; the other mods show themselves when they act, as described in their READMEs. A mod that fails to load is named in a dim line in the transcript; `claude --debug` shows the reason.

## Installing with Claude Code

You can give Claude Code the URL of this repository and ask it to install the mods. Instructions for Claude:

- Ask the user which mods to install and where to clone the repository if they have not said so; default to `~/claude-mods`.
- Follow the steps under [Installation](#installation) in order. Back up `settings.json` before changing it, merge into an existing `CLAUDE_CODE_PLUGIN_DIRS` instead of replacing it, and never remove other keys from `settings.json`.
- For `config-snapshots`, follow its README: skip `claude-config init` if `~/.claude-config.git` already exists, and ask the user for a remote URL instead of inventing one.
- For `jev-compact`, tell the user that asking Jev sends conversation excerpts to OpenRouter or TypeSafe, and let them put the API key into their environment themselves as its README describes; never write a key into `settings.json` or a shell profile.
- Do not install anything with a package manager. If `git`, `jq` or `bash` is missing, tell the user the command to install it and wait.
- Finish by telling the user to restart Claude Code, then how to check each installed mod.

## Updating

```sh
git -C ~/claude-mods pull
```

Restart Claude Code afterwards.

## Uninstalling a mod

Remove its folder from `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` and restart Claude Code. Mod-specific leftovers are listed in each mod's README.

## Developing

Each mod has the same layout:

| Path | Content |
| --- | --- |
| `.claude-plugin/plugin.json` | Name, version, description, user options |
| `hooks/hooks.json` | Points at the hooks module |
| `hooks/register.ts` | The hooks module |
| `hooks/*.test.ts` | Tests |
| `types/index.d.ts` | State contract, where the mod keeps state |

```sh
claude plugin validate machine-guard   # checks manifest and module as Claude Code will load them
claude plugin test machine-guard       # runs the mod's tests
```

Claude Code writes `.claude-plugin/types/` and a `tsconfig.json` into every mod it loads; both are git-ignored. With them in place, `tsc -p <mod>` type-checks the mod.

## License

[MIT](LICENSE)
