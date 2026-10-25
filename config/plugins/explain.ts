// Permission explainer — server half (OpenCode V2 plugin API).
//
// AUDIT ONLY. It never decides (`event.effect` is never touched) and it no
// longer builds any description text: the explanation the user sees is produced
// by the client-side plugin `permission-desc/tui.ts`, which can read the agent's
// own words. Keeping a second copy of the rule table here was pure duplication
// and a maintenance hazard.
//
// Server-side text fields (`event.message`/`metadata`) are not rendered by the
// TUI, so there is nothing to gain from filling them from here.

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
