# Isolation: running the agent as another user

Optional extra boundary for higher-risk work. The normal kit is fully functional without it.
These scripts are **Linux/WSL-only** (POSIX ACLs and `sudo`).

`oc` runs the whole OpenCode process — TUI, server and every command it executes — as a second,
unprivileged user:

```bash
sudo -u agent -H opencode
```

The process boundary is the isolation. The sandbox user has its own home, config, credentials and
a read-only copy of the kit, so it cannot weaken the policies and never reads yours.

## What it protects

| | |
|---|---|
| ✅ | Everything outside the granted directories: other projects, documents, `~/.ssh`, `~/.aws`, keyring |
| ✅ | Your accounts: the agent has no SSH key, cloud token, database credential or push rights |
| ✅ | Publishing: `git push`, remote rewrites and `gh` are hard-denied |
| ❌ | The granted directory itself: the agent edits your real files there; use git as undo |
| ❌ | Secrets stored inside that directory: a token hardcoded in source is readable |

Publishing credentials belong in your home, never in the repository.

## Setup

Projects stay where they are. Grant access to one or more directories:

```bash
# 1. create the account, tighten your home, grant the chosen directories
sudo <kit>/scripts/sandbox-user.sh ~/agent-work/project

# 2. give the sandbox user its own provider login (not yours)
sudo -u agent opencode          # inside: /connect -> OpenCode Go

# 3. install the launcher
install -Dm755 <kit>/scripts/oc.sh ~/.local/bin/oc
```

Passwordless sudo lets `oc` switch user without a prompt:

```text
# /etc/sudoers.d/opencode-sandbox
youruser ALL=(agent) NOPASSWD: ALL
```

Put agent-accessible projects in a dedicated parent such as `~/agent-work`, not inside
`~/Documents`. Sealing walks up to your home, so `~/Documents` becomes inaccessible in one step.
Granting a project inside `~/Documents` would require an ACL for every sibling. The script
refuses `/`, `/home`, your home, `~/Documents` and `~/.config`.

## Daily use

```bash
cd ~/agent-work/project
oc
```

Add a directory later with `sudo <kit>/scripts/sandbox-user.sh <dir>`.

## Verify

```bash
sudo -u agent ls /home/you                  # must FAIL
sudo -u agent ls /home/you/Documents        # must FAIL
sudo -u agent ls /home/you/agent-work/p     # must WORK
```

Inside `oc`, `whoami` must print `agent`.

## Troubleshooting

- **`oc` asks for passwordless sudo** → add the sudoers line above.
- **The agent cannot read the project** → grant that directory.
- **`EACCES … samefile()` after moving a project** → stale `__pycache__`/`.pytest_cache`; remove
  them.
- **“port in use”** → give the sandbox user its own service port:
  `sudo -u agent opencode service set port 49375`.
- **GUI/GPU** → `xhost +SI:localuser:agent`; for GPU add the user to `video,render`. `xhost`
  exposes your screen to the agent, so use it only when windows are required.

## Known residual

The sandbox user owns its own `~/.config/opencode` and could remove the kit links, running
without the global policies. The ACLs still limit it to the granted directories and it has no
credentials, so damage stays inside the project.

## Undo

```bash
sudo setfacl -R -x u:agent ~/agent-work    # revoke a directory
sudo setfacl -x u:agent /home/you          # revoke the traverse ACL
sudo chmod o+rx /home/you                  # restore old home permissions (optional)
sudo userdel -r agent                      # delete the account and its home
rm ~/.local/bin/oc
```

## Alternatives

- **Container/devcontainer:** project mounted read-write, no host credential mounts, never the
  Docker socket. Restrict egress if possible.
- **VM:** strongest; no host shares, snapshot before risky work.
