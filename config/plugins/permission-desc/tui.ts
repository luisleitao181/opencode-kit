import { Plugin } from "@opencode/plugin/tui"

// Permission explainer — client side.
//
// WHAT THE USER SEES: the agent's OWN sentence about what it is doing. The
// `permission.asked` event carries `source: { messageID, id }`, which points at
// the assistant message that produced the tool call — so we fetch that message
// and show the prose the agent wrote just before calling the tool:
//
//     "Vou correr os testes do módulo PID para confirmar a correção"
//
// That is intent, which no command table can ever guess. It ALSO fixes
// subagents: their chat text never reaches the user's transcript, but it is in
// the message store, which we can read.
//
// FALLBACK: when the agent wrote nothing (or the message is not available yet),
// a small rule table gives the COMMAND's consequence instead — the exact target,
// irreversibility, whether data leaves the machine. It deliberately says nothing
// for benign commands, and never emits category labels ("READ-ONLY"), which the
// user already knows and called noise.
//
// The toast API has no hide()/update(), so the text cannot be cleared on reply;
// duration is the only control.

const LOCAL = 2 // changes local state
const RISKY = 3 // irreversible, outward-facing, or opaque

type Rule = { test: RegExp; level: number; explain: (cmd: string) => string | null }

function tail(cmd: string, re: RegExp): string {
  const s = cmd.trim()
  const m = s.match(re)
  return m ? s.slice(m[0].length).trim() : s
}

function operands(s: string): string[] {
  return s.split(/\s+/).filter((p) => p && !p.startsWith("-"))
}

function short(list: string[], max = 3): string {
  if (!list.length) return ""
  const shown = list.slice(0, max).join(" ")
  return list.length > max ? `${shown} +${list.length - max} more` : shown
}

function clip(s: string, n = 240): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

const SHELL_RULES: Rule[] = [
  {
    test: /^(Remove-Item|del|erase|rd|rmdir)\b/i,
    level: RISKY,
    explain: (c) => {
      const rest = tail(c, /^\S+/)
      const recursive = /-Recurse\b|\/s\b/i.test(rest)
      return `DELETES for good${recursive ? ", recursing into directories" : ""}: ${short(operands(rest)) || "?"} (no trash)`
    },
  },
  { test: /^(Move-Item|Rename-Item)\b/i, level: RISKY, explain: (c) => `Moves/renames: ${short(operands(tail(c, /^\S+/)))}` },
  { test: /^(Set-Content|Add-Content|Out-File)\b/i, level: LOCAL, explain: (c) => `Writes file content: ${clip(tail(c, /^\S+/), 100)}` },
  { test: /^(icacls|cacls|attrib|takeown)\b/i, level: LOCAL, explain: (c) => `Changes Windows file ownership/permissions: ${clip(tail(c, /^\S+/), 100)}` },
  { test: /^(Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer|iwr|irm)\b/i, level: RISKY, explain: (c) => `Network request — data can leave the machine: ${clip(tail(c, /^\S+/), 100)}` },
  {
    test: /^rm\b/,
    level: RISKY,
    explain: (c) => {
      const rest = tail(c, /^rm\b/)
      const recursive = /(^|\s)-[a-z]*r/i.test(rest)
      return `DELETES for good${recursive ? ", recursing into directories" : ""}: ${short(operands(rest)) || "?"} (no trash)`
    },
  },
  {
    test: /^mv\b/,
    level: RISKY,
    explain: (c) => {
      const o = operands(tail(c, /^mv\b/))
      return o.length >= 2 ? `Moves ${o[0]} → ${o.slice(1).join(" ")}` : `Moves: ${short(o)}`
    },
  },
  { test: /^truncate\b|^shred\b/, level: RISKY, explain: (c) => `Destroys the contents of: ${short(operands(tail(c, /^\S+/)))}` },
  {
    test: /^chmod\b/,
    level: LOCAL,
    explain: (c) => {
      const o = operands(tail(c, /^chmod\b/))
      return `Changes file permissions to ${o[0] ?? "?"} on: ${short(o.slice(1))}`
    },
  },
  { test: /^chown\b/, level: LOCAL, explain: (c) => `Changes the owner of: ${short(operands(tail(c, /^chown\b/)))}` },
  { test: /^git (status|diff|log|show|branch|blame|rev-parse|ls-files|describe|stash list|tag -l|remote|config)\b/, level: LOCAL, explain: () => null },
  { test: /^git add\b/, level: LOCAL, explain: (c) => `Stages for the next commit: ${short(operands(tail(c, /^git add\b/)))}` },
  { test: /^git commit\b/, level: LOCAL, explain: () => "Creates a LOCAL commit — nothing leaves for the server yet" },
  {
    test: /^git push\b/,
    level: RISKY,
    explain: (c) => {
      const o = operands(tail(c, /^git push\b/))
      return `SENDS commits to the remote${o.length ? ` (${o.join(" ")})` : ""} — others will see them`
    },
  },
  { test: /^git (pull|fetch)\b/, level: LOCAL, explain: () => "Downloads from the remote; pull also rewrites your working tree" },
  {
    test: /^git (checkout|switch|restore)\b/,
    level: RISKY,
    explain: (c) => `Switches/restores ${short(operands(tail(c, /^git (checkout|switch|restore)\b/)))} — uncommitted changes can be LOST`,
  },
  { test: /^git (reset|rebase|revert|merge|cherry-pick)\b/, level: RISKY, explain: (c) => `Rewrites/combines history: ${clip(c, 60)} — can lose work` },
  { test: /^git clone\b/, level: LOCAL, explain: (c) => `Clones a repo to disk: ${short(operands(tail(c, /^git clone\b/)))}` },
  {
    test: /^(curl|wget)\b/,
    level: RISKY,
    explain: (c) => {
      const o = operands(tail(c, /^\S+/))
      const url = o.find((p) => /^https?:\/\//.test(p)) ?? o.find((p) => p.includes(".")) ?? "?"
      const posts = /(^|\s)(-d|--data|--data-raw|--data-binary|-F|--form|-T|--upload-file)/.test(c)
      return `Network request to ${url}${posts ? " — SENDS data out of the machine" : ""}`
    },
  },
  { test: /^(ssh|scp|sftp|rsync)\b/, level: RISKY, explain: (c) => `Copies/connects to another machine: ${short(operands(tail(c, /^\S+/)))}` },
  {
    test: /^(pip|pip3)\s+install|^python3?\s+-m\s+pip\s+install|^uv\s+(pip\s+install|add)|^(npm|yarn|pnpm)\s+(install|add|i)\b|^apt(-get)?\b/,
    level: RISKY,
    explain: (c) => {
      const verbs = /^(install|add|i|upgrade|update|uv|pip|pip3|npm|yarn|pnpm|apt|apt-get|python3?|-m|--save.*)$/i
      const pkgs = operands(c).filter((p) => !verbs.test(p))
      return `INSTALLS ${short(pkgs) || "packages"} — downloads code and changes your environment`
    },
  },
  { test: /^systemctl\b|^service\b/, level: RISKY, explain: (c) => `System services: ${clip(tail(c, /^\S+/), 60)}` },
  {
    test: /^(psql|mysql|mariadb|mongosh|mongo|redis-cli|sqlite3|cqlsh)\b/,
    level: RISKY,
    explain: (c) => {
      const sql = c.match(/-c\s+(['"])(.*?)\1/)
      return sql ? `Runs SQL on a database: ${clip(sql[2], 60)}` : "Connects to a DATABASE — it can modify or delete data"
    },
  },
  { test: /^(pg_dump|mysqldump|mongodump)\b/, level: RISKY, explain: () => "Exports the database to a file — real data leaves the DB" },
  {
    test: /^(python3?|py|node|deno|bun|ruby|perl|php|bash|zsh|sh|source|make|cmake|colcon|cargo|gcc|g\+\+)\b/i,
    level: RISKY,
    explain: (c) => {
      const file = c.split(/\s+/).slice(1).find((p) => /\.(py|js|mjs|cjs|ts|sh|bash|rb|pl|php|c|cpp)$/.test(p))
      return file ? `RUNS \`${file}\` — it has all your permissions` : `RUNS code — it has all your permissions`
    },
  },
  { test: /^docker\b|^podman\b/, level: RISKY, explain: (c) => `Controls containers: ${clip(tail(c, /^\S+/), 60)}` },
  { test: /^(terraform|tofu)\b/, level: RISKY, explain: (c) => `Cloud infrastructure: ${clip(tail(c, /^\S+/), 60)} — can CREATE/DELETE real resources` },
  { test: /^(aws|gcloud|az|kubectl|helm|gh|glab)\b/, level: RISKY, explain: (c) => `Calls ${clip(c.split(/\s+/)[0], 20)} — changes real resources on an external service` },
  { test: /^touch\b|^cp\b|^Copy-Item\b/i, level: LOCAL, explain: (c) => `Creates/copies: ${short(operands(tail(c, /^\S+/)))}` },
  { test: /^(Get-Location|Get-ChildItem|gci|dir|Get-Content|gc|type|Get-Item|Test-Path|Resolve-Path|Select-String|sls|findstr|where(\.exe)?|Get-Command|Measure-Object|Compare-Object|Get-FileHash|Set-Location|sl|Push-Location|Pop-Location|New-Item)\b/i, level: LOCAL, explain: () => null },
  {
    test: /^(ls|pwd|cat|head|tail|wc|tree|file|stat|diff|realpath|grep|rg|find|jq|which|echo|printf|sort|uniq|cut|tr|du|df|free|ps|top|env|date|basename|dirname|readlink|nvidia-smi|xwininfo|od|xxd|hexdump|nl|column|fold|base64|md5sum|sha1sum|sha256sum|cksum|hostname|whoami|id|uname|uptime|sleep|true|false|test|\[|mkdir)\b/,
    level: LOCAL,
    explain: () => null, // benign: nothing to add
  },
]

type Described = { text: string | null; level: number }

function describeOne(action: string, resource: string): Described {
  if (action === "shell") {
    const trimmed = resource.trim()
    for (const rule of SHELL_RULES) {
      if (rule.test.test(trimmed)) return { text: rule.explain(trimmed), level: rule.level }
    }
    return { text: "Not a command the kit knows — read the arguments before allowing", level: RISKY }
  }
  switch (action) {
    case "edit":
      return { text: `Overwrites \`${resource}\` — the previous content is replaced`, level: LOCAL }
    case "webfetch":
      return { text: `Sends a request to \`${resource}\` — leaves your machine`, level: RISKY }
    case "websearch":
      return { text: "Sends the query to a search engine — it leaves your machine", level: RISKY }
    case "external_directory":
      return { text: `Reaches OUTSIDE the project: \`${resource}\``, level: LOCAL }
    default:
      return { text: null, level: LOCAL }
  }
}

function describeAll(action: string, resources: readonly string[], max: number): string | null {
  const ranked = new Map<string, number>()
  for (const resource of resources.slice(0, 200)) {
    const { text, level } = describeOne(action, resource)
    if (!text) continue
    ranked.set(text, Math.max(ranked.get(text) ?? 0, level))
  }
  if (!ranked.size) return null
  const sorted = [...ranked.entries()].sort((a, b) => b[1] - a[1])
  const shown = sorted.slice(0, max).map(([text]) => text)
  const hidden = sorted.length - shown.length
  return shown.join("\n") + (hidden > 0 ? `\n(+${hidden} more)` : "")
}

// The agent's own words, taken from the message that produced this tool call.
// The nearest text part BEFORE the tool call is the sentence that introduces it.
async function agentIntent(context: any, sessionID: string, source: any): Promise<string> {
  if (!source || source.type !== "tool") return ""
  try {
    const store = context.data.session.message
    let message = store.get(sessionID, source.messageID)
    if (!message) {
      await store.sync(sessionID)
      message = store.get(sessionID, source.messageID)
    }
    if (!message || message.type !== "assistant") return ""
    const content = message.content ?? []
    const at = content.findIndex((p: any) => p.type === "tool" && p.id === source.id)
    const upto = at === -1 ? content.length : at
    const texts = content
      .slice(0, upto)
      .filter((p: any) => p.type === "text")
      .map((p: any) => String(p.text ?? ""))
      .filter((t: string) => t.trim())
    return (texts[texts.length - 1] ?? "").trim()
  } catch {
    return ""
  }
}

// Some TUI builds did not render non-ASCII text in toasts. Strip diacritics so
// the message always displays.
function plain(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

export default Plugin.define({
  id: "opencode-kit.permission-desc",
  setup(context) {
    const stop = context.data.on("permission.asked", async (event) => {
      try {
        const { action, resources, sessionID, source } = event.data
        const intent = await agentIntent(context, sessionID, source)
        const text = intent || describeAll(action, resources ?? [], 2)
        if (!text) return // nothing useful to say: stay quiet
        context.ui.toast.show({
          message: plain(clip(text)),
          variant: "warning",
          duration: 120000,
          sessionID,
        })
      } catch {
        // A UI helper must never break the permission flow.
      }
    })
    return () => stop()
  },
})
