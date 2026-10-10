# shell-shim

Fixes the zsh pitfalls Claude's commands trip over, before they run. Claude writes shell commands the way bash reads them; when your shell is zsh, some of them fail or stop halfway, and each failure costs a retry on the whole context. The mod changes only the commands that would hit one of these pitfalls and leaves every other command exactly as Claude wrote it.

| Pitfall in zsh | Example | What the mod does |
| --- | --- | --- |
| A word starting with `=` is replaced by the path of a program, and the rest of the line is aborted | `echo =====`, `[ "$a" == b ]` | `setopt no_equals` in front |
| A value is not split into words | `G="git --git-dir=…"; $G status`, `set -- $spec`, `for f in $files` | `setopt sh_word_split` in front |
| A glob without a match aborts the command | `--include=*.cs`, `https://…/a?b=1`, `rm out/*` on an empty folder | `setopt no_nomatch` in front: the pattern passes through unchanged, as in bash |
| An alias hides the program of the same name | `ls -t` runs `eza`, which reads `-t` differently | `\ls`: the backslash skips the alias |
| A function cannot be defined under an alias's name, and calling it runs the alias | `g() { git --git-dir=… "$@"; }; g log` | `\g` at the definition and at every call |
| `timeout` does not exist on macOS | `timeout 300 node render.mjs` | appends the mod's `bin/` to `PATH`, where `timeout` stands in for GNU's |

No setup needed.

## How it decides

At the first shell command of a session the mod sources the newest zsh snapshot the Bash tool uses (`~/.claude/shell-snapshots/`) in a zsh of its own and asks it which aliases exist, which of them hide a program on `PATH`, and whether `timeout` is installed. It asks again when the snapshot changes.

Each command is then read the way the shell reads it: text in quotes, heredoc bodies and comments are data and never touched; commands inside `$(…)`, backticks and `<(…)` are read like any other. The options go in front of the command only when it needs them, and only the ones it needs.

Word splitting is turned on only for the bash idioms that depend on it: a value used as the command, `set` with a value, the word list of `for`, and an array built from a value. A value used as a plain argument keeps zsh's behaviour, so `ls $DIR` keeps working when the path holds a space, such as `~/Knowledge/Second Brain`.

Only aliases that hide a real program are skipped, `ls`, `egrep` and `fgrep` on a typical Oh My Zsh setup. Claude Code itself replaces `grep` and `find` with its own functions in the snapshot; the mod leaves those alone. A name after `timeout`, `sudo`, `env` or `xargs` is not an alias there in the first place.

## The `timeout` stand-in

`bin/timeout` is a short Perl script, since Perl ships with macOS. It takes `DURATION COMMAND [ARG]...` with `s`, `m`, `h` and `d` suffixes and fractions, `-s SIGNAL` and `-k DURATION`, and exits like GNU timeout: `124` when the time ran out, `125` for its own errors, `126` or `127` when the command cannot run, otherwise the command's own status. It is appended to `PATH`, so a real `timeout` installed later always wins.

## Details and limits

- A command that starts with `sleep` is never changed. That is how Claude polls, and Claude Code refuses it on purpose; an option in front would hide the `sleep` from that check.
- The rewritten command is what the permission check sees. In auto mode that changes nothing; in manual mode a rewritten command may ask where the original would have run without asking.
- Claude only sees the result, not the rewrite. `claude --debug` logs every rewrite with the fixes applied.
- The reading is a heuristic, not a full shell parser. A construct it misreads, such as a `case` inside `$(…)`, is at worst left unfixed: the only changes it ever makes are options in front, a `PATH` addition and a backslash before an unquoted word, which changes nothing where no alias is involved.
- Under bash there is nothing to fix: without a zsh snapshot the mod does nothing.

## Uninstall

Remove the mod from `CLAUDE_CODE_PLUGIN_DIRS`.
