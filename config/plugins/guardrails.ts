// Guardrails plugin (OpenCode V2 plugin API).
//
// Purpose: the LAST line of defence for secrets. Policies in opencode.jsonc
// already deny reading/writing known secret files, but they work on file paths
// and command text. This plugin works on the DATA that flows to the model:
//
//   1. execute.before - hard-block `read` of a real .env file.
//   2. execute.after  - redact secrets found anywhere in a tool result (file
//                       reads, shell output, MCP results) BEFORE the model
//                       sees them.
//
// This is what stops a secret from reaching the remote model provider when it
// is not in a protected path (e.g. a key pasted in the middle of a log file).
//
// NOTE: plugin code runs inside the OpenCode server process with the user's
// full privileges. It is not sandboxed. Read every line before enabling it.

import { Plugin } from "@opencode/plugin"

const REDACTED = "[REDACTED]"

// Deliberately specific: the goal is secrets, NOT to mangle ordinary code the
// agent is reading or debugging (a false positive here costs real usefulness).
const SECRET_PATTERNS: RegExp[] = [
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, // AWS access key id / STS session key
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, // GitHub fine-grained PAT
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\bsk-[A-Za-z0-9_-]{20,}\b/g, // OpenAI / Anthropic (sk-ant-) keys
  /\bhf_[A-Za-z0-9]{30,}\b/g, // HuggingFace tokens
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API keys
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, // Stripe keys
  // Whole PEM/PGP private key block: header AND the base64 body.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /"private_key"\s*:\s*"-----BEGIN[\s\S]*?-----END[^"]*"/g,
  // Header-only fallback: a truncated key still hides its header.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  // key = "quoted value" (snake_case AND camelCase names); the quotes keep
  // `secret = compute()` and `password = self.derive()` untouched.
  /(?<![A-Za-z0-9])(api[_-]?key|apikey|secret[_-]?key|secretkey|secret|client[_-]?secret|clientsecret|token|access[_-]?token|accesstoken|auth[_-]?token|authtoken|password|passwd|passphrase)\s*[:=]\s*["']([^"'\n]{8,})["']/gi,
  // ENV_STYLE_NAME=longrandomvalue (unquoted, 24+ chars, no spaces/parens).
  /(?<![A-Za-z0-9_])([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIALS?))\s*=\s*([A-Za-z0-9_+\/.-]{24,})/g,
]

// A real .env (not .env.example) must never be read, even if it slipped past
// the policy layer.
const ENV_FILE = /(^|[\\/])\.env([^\\/]*)$/
const ENV_EXAMPLE = /\.env\.example$/

function redact(text: string): string {
  let out = text
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (...args: unknown[]) => {
      const label = typeof args[1] === "string" ? args[1] : undefined
      return label ? `${label}=${REDACTED}` : REDACTED
    })
  }
  return out
}

const MAX_DEPTH = 6

// Tool results are not always `{ content }`: shell may return strings, MCP
// servers often return `{ output, data, stdout, ... }`. Walk every string in
// the value (bounded depth, cycle-safe) instead of guessing the shape.
function redactValue(value: unknown, depth: number, seen: Set<unknown>): unknown {
  if (typeof value === "string") return redact(value)
  if (depth > MAX_DEPTH || !value || typeof value !== "object") return value
  if (seen.has(value)) return value
  seen.add(value)
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = redactValue(value[i], depth + 1, seen)
    }
    return value
  }
  const obj = value as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    obj[key] = redactValue(obj[key], depth + 1, seen)
  }
  return value
}

export default Plugin.define({
  id: "opencode-kit.guardrails",
  async setup(ctx) {
    // 1. Block reads of a real .env file.
    await ctx.tool.hook("execute.before", (event) => {
      if (event?.tool !== "read") return
      const input = event.input as
        | { path?: string; filePath?: string; file_path?: string }
        | string
        | undefined
      const path =
        typeof input === "string"
          ? input
          : (input?.path ?? input?.filePath ?? input?.file_path ?? "")
      if (ENV_FILE.test(path) && !ENV_EXAMPLE.test(path)) {
        throw new Error(
          "Blocked by opencode-kit guardrails: reading a .env file is not allowed.",
        )
      }
    })

    // 2. Redact secrets from every tool result before it reaches the model.
    //    Never throw here (a redaction bug must not break tool execution) but
    //    never fail silently either: an error is logged to the server log.
    await ctx.tool.hook("execute.after", (event) => {
      if (event?.status !== "completed") return
      try {
        if (typeof event.result === "string") {
          event.result = redact(event.result)
          return
        }
        event.result = redactValue(event.result, 0, new Set())
      } catch (err) {
        console.error("[opencode-kit.guardrails] redaction failed:", err)
      }
    })
  },
})
