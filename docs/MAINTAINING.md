# Maintaining the kit

Notes for changing agents, permissions, plugins and MCPs. This file is not loaded into agent
sessions; it exists for humans editing the repository.

## Configuration format

The kit targets **OpenCode V2** (`@opencode/cli`), not the legacy `opencode-ai` package.

- Agent files use native V2 fields: `permissions` (ordered array), `request: { body: ... }`,
  `model: provider/model#variant`, `steps`, `mode`, `hidden`, `disabled`.
- Keep each agent file in one format. Mixing legacy fields with V2 fields is unsafe: in V2.0.x a
  legacy `temperature` beside `permissions:` caused the entire permission list to be discarded,
  and a legacy `permission:` map beside `request:` nested it incorrectly. If you must keep a
  legacy file, convert it completely.
- Per-agent `request.body` values are preserved but were not sent by the V2.0.x runner. Use model
  variants (`provider/model#variant`) or provider/model settings for active sampling settings.
- `experimental.subagent_depth` must stay inside `experimental`; at the top level it is ignored.
  Default is `1`. The kit uses `2` so `developer` can launch `robotics`.
- Only `mode: subagent` or `mode: all` agents can be launched as children.
- The background service does not always notice edits to global agent files. Restart it with
  `opencode service restart` when a change appears ignored.

## Configuration shape

- V2 groups MCP servers under `mcp.servers` and uses `disabled: true`, not `enabled`.
- Updates use `update` (`notify`, `auto`, `disable`); `small_model` is replaced by
  `agents.title.model`.
- `external_directory` is allowed by default in V2. Keep the explicit `ask` rule before the
  scratch-directory exceptions so access outside the project prompts.
- Command frontmatter uses `subagent: true`; `subtask` is legacy.
- Shell rules are case-sensitive on Linux and case-insensitive on Windows. Keep OS-specific
  rules separate enough that they cannot accidentally match the other platform.

## Plugins

- V2 discovers global plugins under `~/.config/opencode/plugins/` and resolves
  `@opencode/plugin` at runtime, so local plugins need no `package.json`.
- A plugin directory can provide `index.ts` (server) and `tui.ts`/`tui.tsx` (terminal client); a
  TUI-only plugin may provide the client file alone. Packaging a plugin for reuse requires a
  `package.json` with a `./tui` export.
- Media assets never live in the repository. `flair` reads its cue and frames from
  `~/.config/opencode/flair` (or `FLAIR_DIR`), built by `scripts/flair.py`, and stays a no-op
  when they are absent, so the repo holds code only.
- The audit log belongs under the OS temporary directory (`os.tmpdir()`), never a hardcoded
  `/tmp`.
- After changing a plugin, restart the service and check `opencode plugin list` plus the server
  log. The TUI half requires reopening the TUI.

## Validation before release

```bash
opencode debug config >/dev/null
opencode debug agents >/dev/null
opencode plugin list
opencode mcp list
```

Then start the TUI and check that **Tab** cycles agents, a subagent responds, a permission prompt
appears, and a fake secret in a scratch file is redacted.

Check configuration warnings in `~/.local/share/opencode/log/opencode.log`; invalid policy
statements are dropped with only a log warning.

## Repository layout

- One branch supports Windows and Linux. `opencode.jsonc` contains both rule sets; rules that do
  not apply to the current OS never match.
- Machine-specific facts live in `config/instructions/<os>.example.md` (committed) and
  `<os>.local.md` (gitignored). Installers copy the local file when present, otherwise the
  template.
- `scripts/install.sh` uses symlinks; `scripts/install.ps1` uses directory junctions and file
  hardlinks. Windows hardlinks require the repository and config directory on one NTFS volume.
- Never commit credentials, `.env` files, `auth.json`, or machine session data.

## Publishing

Publishing is intentionally left to the user: the kit's policies deny `git push`, remote
rewrites and `gh` for agents. The user runs `git remote add` and `git push` explicitly.
