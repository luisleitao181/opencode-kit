#!/usr/bin/env bash
#
# oc — run OpenCode as the sandbox user, in the current directory.
#
#   cd ~/agent-work/my-project
#   oc
#
# The whole process (TUI + server + every command it runs) executes as the
# sandbox user, so the isolation is the process itself: no separate server, no
# authentication, nothing to keep in sync.
#
# The sandbox user has its own copy of the kit (same agents, commands, plugins
# and policies), so the interface is identical.
#
# Requires: the account created by scripts/sandbox-user.sh, and passwordless
# sudo for it (see docs/ISOLATION.md).
#
set -euo pipefail

AGENT_USER="${OPENCODE_SANDBOX_USER:-agent}"

if ! id -u "$AGENT_USER" >/dev/null 2>&1; then
  echo "oc: user '$AGENT_USER' does not exist. Run scripts/sandbox-user.sh first." >&2
  exit 1
fi

if ! sudo -n -u "$AGENT_USER" true 2>/dev/null; then
  echo "oc: passwordless sudo for '$AGENT_USER' is required (see docs/ISOLATION.md):" >&2
  echo "    echo '$(id -un) ALL=($AGENT_USER) NOPASSWD: ALL' | sudo tee /etc/sudoers.d/opencode-sandbox" >&2
  exit 1
fi

# -H: HOME becomes the sandbox user's home, so OpenCode uses ITS config,
#     state and credentials (never yours).
exec sudo -n -u "$AGENT_USER" -H opencode "$@"
