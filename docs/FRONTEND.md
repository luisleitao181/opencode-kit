# Frontend and design workflow

`@app-developer` is the only agent allowed to use the Figma MCP and the design skills. The
server and the skills are installed only in the projects that need them, so backend, robotics and
infrastructure sessions pay no context cost.

## What is in the kit

- `config/agents/app-developer.md`: frontend implementation and design polish.
- `config/opencode.jsonc`: the remote Figma MCP server, denied globally and enabled only in
  `app-developer` (`figma_*`).
- Global `skill` denials for `impeccable`, `emil-*` and `figma-*`; `app-developer` re-allows only
  the skills listed below.

The kit does **not** vendor third-party skills. Install them in the project so their licenses,
updates and scope stay with the upstream project.

## Per-project setup

From the frontend project root:

```bash
# One design-direction skill.
npx impeccable install --providers=opencode --scope=project

# Selected motion/design engineering skills (not the whole pack).
npx skills add emilkowalski/skills --agent opencode --skill emil-design-eng
npx skills add emilkowalski/skills --agent opencode --skill animate
npx skills add emilkowalski/skills --agent opencode --skill review-animations
npx skills add emilkowalski/skills --agent opencode --skill pick-ui-library
```

OpenCode reads `.opencode/skills`, `.agents/skills` and `.claude/skills`; the CLI installs into
the directory for the selected agent.

`app-developer` allows exactly these IDs:

- `impeccable`
- `emil-design-eng`
- `animate`
- `review-animations`
- `pick-ui-library`
- `figma-*`

Other design skills are hidden from that agent even if installed. Change the allowlist in
`config/agents/app-developer.md` before adding a new skill.

## Figma MCP

The server is configured globally at `https://mcp.figma.com/mcp`, but its tools are denied to
every agent except `app-developer`. Authenticate once per machine:

```bash
opencode mcp auth figma
opencode mcp list
```

In the TUI, `/mcps` does the same. Paste a Figma file or selection link in the prompt; the server
uses that node as context. Write-to-canvas requires a Full seat and edit access, and may later
become a paid feature.

Figma's optional skills can be downloaded from
[figma/mcp-server-guide](https://github.com/figma/mcp-server-guide) and copied into the project's
`.opencode/skills`. They are not vendored here because the repository has no clear redistribution
license. OpenCode loads them as normal `SKILL.md` skills; Claude-specific slash commands are not
guaranteed to appear with the same names.

## Token control

- Install only the skills the project actually uses. `app-developer` hides the rest.
- Impeccable and Emil are loaded on demand; only their names and descriptions are advertised.
- Do not install Taste Skill alongside Impeccable: both impose a visual direction and their
  instructions conflict. Taste is also much heavier (Node/Chrome, long visual loops).
- `app-developer` has `steps: 30` to cap runaway design iterations.
- Browser verification remains with `@web-tester` and its Playwright MCP.
