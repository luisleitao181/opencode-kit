# OpenCode Kit

A portable OpenCode V2 setup kept as a repository: ten agents with per-role models, shared
rules, platform skills, MCP servers and a security layer enforced by permissions and policies.

Clone it, run one script, connect your provider.

## Requirements

- **OpenCode V2** (`@opencode/cli`). V1 (`opencode-ai`) uses a different config format and cannot
  read this kit.
- `git`.
- **Windows:** PowerShell. Optional Node/npx for the Playwright and memory MCPs.
- **Linux/WSL:** bash. Optional Node/npx for the local MCPs; a user-level `nvm` install is fine.

## Install

### Windows

```powershell
npm uninstall -g opencode-ai                 # only if V1 is installed
npm install -g @opencode/cli
git clone https://github.com/luisleitao181/opencode-kit.git $HOME\Documents\opencode-kit

powershell -NoProfile -ExecutionPolicy Bypass -File `
  $HOME\Documents\opencode-kit\scripts\install.ps1

opencode                                     # then: /connect -> OpenCode Go
```

`install.ps1` links the repository's `agents/`, `commands/`, `skills/` and `plugins/` into
`~/.config/opencode` (junctions, plus hardlinks for the two config files). Use `-Copy` for a
standalone copy. Re-run it if an editor replaces a hardlinked file on save.

### Linux / macOS / WSL

```bash
curl -fsSL https://opencode.ai/v2/install | bash
git clone https://github.com/luisleitao181/opencode-kit.git ~/opencode-kit
~/opencode-kit/scripts/install.sh
opencode                                     # then: /connect -> OpenCode Go
```

`install.sh` symlinks the kit into `~/.config/opencode`. In WSL, `command -v opencode` must return
a Linux path, not `/mnt/c/.../npm/opencode`; if Windows interop wins, put this at the top of both
`~/.profile` and `~/.bashrc`:

```bash
export PATH="$HOME/.opencode/bin:$PATH"
```

Keep WSL projects in the Linux filesystem (`~/...`), not `/mnt/c/...`.

### Machine facts

Every machine needs its own interpreter, ROS and toolchain notes. The committed
`config/instructions/<os>.example.md` is a template. To keep real values unversioned, create
`config/instructions/windows.local.md` or `linux.local.md`; the installer copies the local file
when present, otherwise the example, to `~/.config/opencode/instructions/machine.md`.

## How to run it in VS Code

- **Windows projects** (Python, React/Node, Java, .NET): open the folder normally and use a
  **PowerShell** terminal (`Terminal > New Terminal`), then run `opencode`.
- **ROS 2 / C++ projects:** use `WSL: Connect to WSL using Distro` and open the folder inside the
  Linux filesystem, then run `opencode` in its WSL terminal.
- Do not launch the Windows `opencode` binary from a WSL shell.

## Verify

```powershell
opencode --version                 # 2.x
opencode debug config              # config parses
opencode debug agents              # all agents load
opencode plugin list               # guardrails, explain, flair
opencode mcp list                  # remote MCPs connect; local ones need Node
```

In the TUI: **Tab** cycles agents, `@researcher` answers, and `/review` runs on a git diff.

## Daily use

- **Tab** switches primary agents; **@name** launches a subagent.
- `/review`, `/debug <error>`, `/devloop`, `/security-review`, `/add-platform <name>`.
- Cheap subagents (`researcher`, `docs-writer`, `tester`) protect the main model's quota.
- Optional **flair**: one plugin that plays a whip-crack cue and/or animates a sticker on
  prompt submit. `python3 scripts/flair.py setup --sticker <animation>` builds it from an
  APNG, animated WebP, GIF or short video (needs `ffmpeg`); `setup` alone makes the cue.
  Assets stay in `~/.config/opencode/flair` (or `FLAIR_DIR`) and the plugin no-ops without
  them, so nothing is committed and a fresh clone is unaffected.
- **Shift+drag** selects text in the TUI.

## Layout

```text
config/
  opencode.jsonc      models, permissions, policies, MCP servers
  AGENTS.md           global rules loaded in every session
  instructions/       per-machine fact templates (example/local)
  agents/             ten agent definitions
  commands/           /review /debug /devloop /security-review /add-platform
  plugins/            guardrails, permission audit, optional flair
  skills/             ros2-python, isaac-sim, webots, unity
scripts/
  install.sh          Linux/WSL installer (symlinks)
  install.ps1         Windows installer (junctions/hardlinks, or -Copy)
  design-skills.mjs   install/status/uninstall design skills per project
  flair.py            set up / inspect the optional flair assets
  generate-sound.py   synthesise the fallback cue WAV
  fetch-mp3.py        download the recorded cue
  fetch-sticker.py    convert an animated sticker into flair frames
  secure-commit.sh    pre-commit secret scanner for your own repositories
  gitignore-security.txt  .gitignore block for secrets
  audit-deps.sh       dependency audit that fails only on new vulnerabilities
  sandbox-user.sh     optional Linux/WSL isolation setup
  oc.sh               optional launcher for the sandbox
docs/MAINTAINING.md   configuration and plugin notes for humans
docs/ISOLATION.md     optional sandbox setup and troubleshooting
SECURITY.md           threat model and limits
```

## Agents and models

| Agent | Mode | Model | Role |
|---|---|---|---|
| `orchestrator` | primary | deepseek-v4.1-flash | Default; routes work to specialists |
| `developer` | all | kimi-k2.7-code | General software development |
| `app-developer` | all | kimi-k2.7-code | Frontend/UI; only agent with Figma and design skills |
| `robotics` | subagent | glm-5.2 | Math, physics and robotics algorithms |
| `tester` | subagent | deepseek-v4.1-flash | Runs tests and reports facts |
| `reviewer` | subagent | minimax-m3 | Read-only code review |
| `researcher` | subagent | deepseek-v4.1-flash | Library and web documentation |
| `docs-writer` | subagent | deepseek-v4.1-flash | README, docstrings, changelogs |
| `debugger` | subagent | kimi-k3 | Hard bugs: root cause |
| `web-tester` | subagent | minimax-m3 | Playwright browser automation |

`build` and `plan` remain cheap fallbacks. `developer` may launch `@robotics` directly
(`experimental.subagent_depth: 2`); reviews and tests always go through the orchestrator.

Model IDs assume an OpenCode Go subscription. Change the `opencode-go/...` references if you use
another provider.

## MCP servers

| MCP | Used by | Purpose | Needs Node |
|---|---|---|---|
| `context7` | developer, app-developer, robotics, researcher, docs-writer | Library docs | no (remote) |
| `exa` | researcher, docs-writer | Web search | no (remote) |
| `playwright` | web-tester | Browser automation | yes |
| `memory` | orchestrator | Project memory | yes |
| `figma` | app-developer | Design context and canvas writes | no (OAuth) |

MCP tools are denied globally and enabled per agent in its frontmatter, so they cost no context
where unused.

## Security

The full model, including what is *not* protected, is in **[SECURITY.md](SECURITY.md)**.

- **Permissions:** routine navigation, read-only git, tests, linters and builds run automatically;
  everything else asks.
- **Policies:** hard denials for privilege escalation, destructive disk operations, history
  rewrites, publishing (`git push`, remote rewrites, `gh`), database drops and credential files.
  They cannot be overridden by an agent or a saved approval.
- **Plugins:** `guardrails` redacts secrets from tool output; `explain` writes an audit log of
  permission requests.
- **Limit:** these are seat belts, not a sandbox. Arbitrary code you approve runs with your
  authority.

### Optional isolation

Higher-risk work can run the whole agent as a separate unprivileged Linux user with no
credentials. Agents, models, MCPs and Go work without it. Setup, checks and teardown are in
[docs/ISOLATION.md](docs/ISOLATION.md).

## Customise

- Add an agent: create `config/agents/<name>.md` with V2 frontmatter.
- Add a platform: `/add-platform mujoco`, or copy a folder under `config/skills/`.
- Add an MCP: configure it under `mcp.servers` in `config/opencode.jsonc`, deny its tools
  globally and allow them only in the agents that need it.
- Maintainer notes: **[docs/MAINTAINING.md](docs/MAINTAINING.md)**.

## Windows and Linux together

Use one branch. The config contains rules for both operating systems; rules that do not match the
current platform are inert. Keep a clone on each host and synchronise with git. Credentials,
sessions and OpenCode installations stay local to each host.

## License

The code is MIT; see [LICENSE](LICENSE).

No third-party media is stored here. The optional cue is fetched at runtime and plays
under **CC BY 3.0** (Mike Koenig, SoundBible); attribution and source links are in
[config/plugins/flair/CREDITS.md](config/plugins/flair/CREDITS.md).
