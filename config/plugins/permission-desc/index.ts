import { Plugin } from "@opencode/plugin"

// Server half of the `permission-desc` plugin — intentionally a NO-OP.
//
// The work happens in `tui.ts` (TUI/client side: shows the toast when a
// permission is asked). This entrypoint exists only so the folder matches the
// documented layout `<config>/plugins/<name>/index.ts` + `<name>/tui.ts`.
//
// Server-side auditing and the `permission.evaluate` hook already live in
// `config/plugins/explain.ts`; duplicating them here would write the audit log
// twice, so this deliberately does nothing.

export default Plugin.define({
  id: "opencode-kit.permission-desc.server",
  setup() {},
})
