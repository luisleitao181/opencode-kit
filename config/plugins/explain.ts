// Permission audit trail (OpenCode V2 plugin API).
//
// Read-only observer: it never decides (`event.effect` is never touched). Every
// permission request resolved to "ask" is appended to a local log, which helps
// review what the agent tried to do without showing anything in the TUI.

import { Plugin } from "@opencode/plugin"
import { appendFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const AUDIT_DIR = join(tmpdir(), "opencode")
const AUDIT = join(AUDIT_DIR, "permission-audit.log")

function audit(line: string): void {
  try {
    mkdirSync(AUDIT_DIR, { recursive: true })
    appendFileSync(AUDIT, `${new Date().toISOString()} ${line}\n`)
  } catch {
    // never let auditing break the flow
  }
}

export default Plugin.define({
  id: "opencode-kit.explain",
  async setup(ctx) {
    await ctx.permission.hook("evaluate", (event) => {
      if (event.effect !== "ask") return
      const resources = event.resources ?? []
      if (!resources.length) return
      audit(`ASK ${event.action}: ${resources.join(" | ")}`)
    })
  },
})
