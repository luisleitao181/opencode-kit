# Security model

What this kit protects against, and what it does not. The rules are designed for **mistakes**,
not for a determined adversarial agent: anything that can run a shell with your authority can, in
the limit, do anything you can. Treat them as a seat belt, not a sandbox.

## Layers

| Layer | Where | Stops |
|---|---|---|
| **Secrets** | `policies` | Reading or writing `.env`, SSH/AWS/gcloud/gh credentials, `.netrc`, `.git-credentials`, `.pgpass`, `id_rsa*`, `*.pem`, `*.key` — via files and shell |
| **Hard bans** | `policies` | Privilege escalation, destructive disk commands, history rewrites, database drops, and publishing (`git push`, remote rewrites, `gh`) |
| **Friction** | `permissions` | Narrow shell allowlist: routine work is automatic; writes, installs, network clients and interpreter scripts ask |
| **Git hygiene** | `scripts/secure-commit.sh` | Committing a secret from any source (optional pre-commit scan) |
| **Guardrails** | `plugins/guardrails.ts` | Secrets in a tool result reaching the model; they are redacted first |
| **Dependency audit** | `scripts/audit-deps.sh` | New dependency vulnerabilities (optional) |

`permissions` are ordered and the last match wins. `policies` are evaluated after permissions and
saved approvals, so they cannot be overridden by an agent or a project. Rules for the other
operating system never match, and external directories ask by default.

The guardrails plugin is the last line for data that slips through a path rule. It is a safety
net, not a guarantee: patterns can miss unusual secret formats.

## What is not protected

- **Arbitrary code.** Once you approve a script, it runs with your full authority.
- **Network egress.** `curl`/`wget` ask, but allowed web access can still send data out.
- **The model provider.** Anything in the context reaches a remote model. Never paste real
  credentials into a prompt.
- **Real accounts.** The kit cannot tell a toy repo from production. This is why publishing is
  denied and why isolation exists.

## Secrets hygiene

- Secrets live in environment variables or an untracked `.env`, never in code.
- Commit `.env.example` (keys, no values); never `.env`.
- Apply `scripts/gitignore-security.txt` to new repositories and optionally install
  `scripts/secure-commit.sh`.
- Inject CI secrets through the platform's secret store.

## Isolation (optional)

The rules above reduce the blast radius. For a real boundary, run the entire agent as a separate
unprivileged Linux user with no credentials and access to one directory tree. This is optional;
agents, models, MCPs and OpenCode Go work without it. The scripts are Linux/WSL-only.

It protects everything outside the granted directory, your accounts and your SSH/cloud
credentials. It does **not** protect the granted directory itself or secrets hardcoded inside it.
Rule of thumb: publishing credentials live in your home, never in the repo.

Setup, checks, limitations and removal: **[docs/ISOLATION.md](docs/ISOLATION.md)**.

## If something goes wrong

- **Secret committed:** rotate it first, then rewrite history with `git filter-repo` yourself.
- **Bad local change:** inspect `git status`/`git stash` before resetting; hard resets are denied
  on purpose, so recovery stays possible.
- **Data deleted:** restore from backup; prefer a backup step over relying on deletion.
