# Global rules (apply to every project)

## Communication
- Reply in the language the user writes in, unless the project's code/documentation is in another language.
- Be concise: no preamble, no repeating what was already said, no long summaries at the end.
- Code, comments and commit messages in English.

## Security layer (auto-run vs. needs approval)
Two ordered layers in `opencode.jsonc` (OpenCode V2), summarised here.

**`permissions`** — per-tool rules; the LAST matching rule wins; with no match the default
is **ask**. Routine development runs automatically; everything else asks.
- Auto-allowed: read-only navigation (`ls`, `cat`, `grep`, `rg`, `find`, `pwd`, `mkdir` on
  Unix; `Get-ChildItem`, `Get-Content`, `Select-String`, `Test-Path`, `dir`, `where` on
  Windows), read-only git (`status`, `diff`, `log`, `show`, `branch`, `blame`, `rev-parse`,
  `ls-files`, `describe`, `config --get`) and known toolchains (`python`/`python3 -m
  pytest|ruff|black|mypy|flake8`, `pytest`, `ruff`, `npm run`, `make`, `cmake --build`,
  `cargo build|test|clippy`, `colcon build|test`, `dotnet build|test`).
- Asks: git writes (commit/push/checkout/rebase/merge/tag), deletion/moves/permission changes,
  installs (`pip install`, `npm install`, `apt`), `systemctl`, `scp`/`rsync`/`ssh`,
  `curl`/`wget`, database clients, cloud CLIs (`gh`, `aws`, `gcloud`, `kubectl`, `docker`) —
  and **any `python <script>`, `python3 <script>` or `-c`**: an agent-authored script can do
  anything, so it is never auto-approved. Scratch exception: `rm -rf /tmp/opencode/*` is
  allowed on Linux. Windows deletions ask. Access outside the project also asks, except the
  OS-specific disposable scratch directory.

**`policies`** — hard `deny` rules that never prompt and cannot be undone by an agent rule,
a saved "Allow always", or a project config. The non-negotiables:
- privilege escalation: `sudo`/`su`/`doas`, `runas`, `Start-Process -Verb RunAs`;
- destructive filesystem: `mkfs`, `dd`, `shred`, `rm -rf /`, `rm -rf ~`, `rm -rf $HOME`,
  `format`, `diskpart`, `Clear-Disk`, `cipher /w`, and recursive deletion of Windows drive/home
  roots;
- git history: `reset --hard`, `clean -f`, `filter-branch`/`filter-repo`;
- **publishing**: the agent never pushes (`git push*`), never rewires remotes (`git remote add`/
  `set-url`/`remove`), and has no `gh`. Publishing is the user's job. Reading is untouched
  (`git remote -v` stays allowed);
- databases: `DROP DATABASE`, `DROP TABLE`, `FLUSHALL` anywhere in the command;
- **secrets**: reading/writing `.env` (except `.env.example`) and any access to
  SSH/AWS/gcloud/gh credentials, `.netrc`, `.git-credentials`, `.pgpass`, `id_rsa*`,
  `*.pem`, `*.key` — via the read tool and via shell (the pattern matches the command text,
  so avoid those literals in greps/scripts).

**Honest limit:** permissions are a seat belt, not a sandbox. `shell` runs with the user's
full filesystem/process/network authority and the command scanner is best-effort, so no
rule set can stop a determined agent. Real isolation = a container/VM or a separate
unprivileged user with no access to the real accounts (see `SECURITY.md` and
`docs/ISOLATION.md`).

## Saving tokens
- Read only what's needed: use grep/glob and read file ranges instead of whole files.
- For broad code searches, delegate to the `researcher` subagent.
- Don't re-read files you just edited.
- Don't print huge logs/outputs: filter with `head`, `tail`, `grep`.
- Use MCPs only when really needed (library docs -> `context7`).

## OpenCode config
- Use native V2 fields only and keep each agent file in one format. Never mix legacy
  `temperature`/`permission:` with V2 `request:`/`permissions:`; the legacy field silently wins.
- `permissions` are ordered (last match wins); `policies` are hard denials. Add exceptions after
  the broad rule.
- `experimental.subagent_depth` belongs inside `experimental`; only `subagent`/`all` agents can
  be launched as children.
- If a config or plugin edit appears ignored, restart the service (`opencode service restart`).
- Maintainer details and version-specific caveats: `docs/MAINTAINING.md`.

## How to work
- GUI/long-running processes: start them with `background: true` (never block a shell call on a window, never with
  a timeout - the user closes it) and keep viewing OFF the critical path: the computation/logging must finish on
  its own (files or topics), so starting or closing a viewer cannot change the result.
- A window closing is not a failure. Never relaunch a GUI to "keep it alive", never retry it, never probe the
  display. Before reacting, tell three cases apart: the user closed the view (normal), the process really died
  (exit code/log shows it), or the code is buggy (only the last two are findings).
- **Always write ONE short line of intent immediately before calling a tool that will need
  approval** — what you are about to do and why ("running the PID tests to confirm the fix").
  The `permission-desc` plugin reads that text from the message carrying the tool call and shows
  it in the permission prompt, for the main agent AND for subagents (whose chat text otherwise
  never reaches the user). Without your line the prompt falls back to a generic description of
  the command, which is far less useful. Add the specifics the command text cannot show: which
  files, which remote, what gets discarded. Never assume the user knows what a command does.
- Tests: `@tester` reports what is NOT covered, not just a percentage. For new code, cover the
  behaviour (edge cases included). Only enforce a numeric threshold if the project already
  defines one — otherwise the number becomes a box to tick instead of a signal.
- Ambiguous or large task: first propose a short plan and ask for confirmation.
- Small, focused changes; don't refactor what wasn't asked.
- After changing code, run the relevant tests/linters before saying it's done.
- Never write secrets (API keys, tokens) into versioned files.
- Before destructive commands (rm, git reset --hard, force push) ask.

## Python / Robotics (user default)
- Python 3, isolated environments (`venv` or `uv`); don't install packages globally.
- Use the interpreter and tools named by `instructions/machine.md`: `python`/`py` on native
  Windows, `python3` on Linux. Never copy machine-specific paths or ROS versions between hosts.
- Native Windows work uses the Windows binary and PowerShell; WSL work uses the Linux binary and
  bash. Do not invoke the Windows `opencode` through `/mnt/c/...` from WSL.
- Type hints and short docstrings in new code; tests with `pytest`.
- In ROS 2: small nodes, declared parameters, no hardcoded magic values; SI units.
- In simulation (Isaac Sim/Lab, Webots, Unity): separate control logic from the simulator layer
  so it can run on real hardware or another simulator.
- There are platform skills (`ros2-python`, `isaac-sim`, `webots`, `unity`): load the relevant one
  with the `skill` tool when the task touches it.
