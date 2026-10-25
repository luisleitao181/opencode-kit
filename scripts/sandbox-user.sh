#!/usr/bin/env bash
#
# sandbox-user.sh — one-time setup of the isolated "agent" user (isolation option 2).
#
# WHAT IT DOES
#   Creates a second, unprivileged user and grants it access to ONE OR MORE
#   directories of your choice — and to nothing else in your home. The OpenCode
#   server then runs as that user, so every command the agent executes runs with
#   ITS permissions, not yours.
#
# USAGE (run with sudo; one or more directories the agent may touch)
#
#   sudo ./scripts/sandbox-user.sh ~/Documents/robotics/pid_controller
#   sudo ./scripts/sandbox-user.sh ~/Documents/web/app1 ~/Documents/web/app2
#
#   WARNING: everything UNDER a listed directory becomes readable and writable
#   by the agent user. Do not pass your home, your Documents, or "/".
#
# TO UNDO
#   sudo setfacl -R -x u:agent <dir>     # revoke a directory
#   sudo setfacl -x u:agent <ancestors>  # revoke the traverse entries
#   sudo userdel -r agent                # remove the account
#
set -euo pipefail

AGENT_USER="${AGENT_USER:-agent}"
AGENT_HOME="/home/$AGENT_USER"
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

die() { echo "error: $*" >&2; exit 1; }
say() { echo "  -> $*"; }

[ "$(id -u)" -eq 0 ] || die "run this with sudo"
[ "$#" -ge 1 ] || die "usage: $0 <work-dir> [<work-dir> ...]   (the directories the agent may touch)"

OWNER="${SUDO_USER:-}"
[ -n "$OWNER" ] || die "could not detect the invoking user (SUDO_USER unset); run it with sudo, not as root directly"
OWNER_HOME="$(getent passwd "$OWNER" | cut -d: -f6)"
[ -d "$OWNER_HOME" ] || die "home of '$OWNER' not found: $OWNER_HOME"

command -v setfacl >/dev/null || die "setfacl is missing (apt install acl)"

# --- validate every directory before touching anything -----------------------
# NOTE: in `case` patterns `*` also matches `/`, so broad paths are listed
# explicitly instead of using wildcards.
WORK_DIRS=()
for raw in "$@"; do
  d="$(realpath -m "$raw")"
  case "$d" in
    /|/home|"$OWNER_HOME"|"$OWNER_HOME"/Documents|"$OWNER_HOME"/.config|"$AGENT_HOME")
      die "'$d' is too broad. Pick a dedicated directory — everything under it is exposed." ;;
  esac
  WORK_DIRS+=("$d")
done

echo "== 1/6 account '$AGENT_USER'"
if id -u "$AGENT_USER" >/dev/null 2>&1; then
  say "already exists"
else
  adduser --disabled-password --gecos "OpenCode sandbox" "$AGENT_USER"
  say "created $AGENT_HOME"
fi

echo "== 2/6 locking down $OWNER_HOME (no world read) + traverse-only for the agent"
chmod o-rwx "$OWNER_HOME"
setfacl -m "u:$AGENT_USER:--x" "$OWNER_HOME"
say "perms now $(stat -c '%A' "$OWNER_HOME"), plus an ACL entry for $AGENT_USER (traverse only)"

echo "== 3/6 traverse-only on the intermediate directories"
# Without this the agent could list every subdirectory it can reach (they are
# usually 755), so it could read anything world-readable beside your projects.
for d in "${WORK_DIRS[@]}"; do
  p="$(dirname "$d")"
  while [ "$p" != "$OWNER_HOME" ] && [ "$p" != "/" ]; do
    case "$p" in
      "$OWNER_HOME"/*) ;;   # only walk inside the home
      *) break ;;
    esac
    if [ -d "$p" ]; then
      setfacl -m "u:$AGENT_USER:--x" "$p"
      say "traverse-only: $p"
    fi
    p="$(dirname "$p")"
  done
done

echo "== 4/6 granting access to the work directories (files rw, dirs rwx)"
for d in "${WORK_DIRS[@]}"; do
  [ -d "$d" ] || { echo "  creating $d"; mkdir -p "$d"; chown "$OWNER:$OWNER" "$d"; }
  setfacl -R -m "u:$AGENT_USER:rwX" "$d"
  # Default ACLs (inherited by files created LATER) only apply to directories.
  find "$d" -type d -exec setfacl -d -m "u:$AGENT_USER:rwX" {} +
  # Stale bytecode embeds the OLD absolute path. If the project was moved and the
  # old path is now sealed, pytest/python fail with EACCES on samefile(). Clear it.
  find "$d" -type d \( -name __pycache__ -o -name .pytest_cache \) -prune -exec rm -rf {} + 2>/dev/null || true
  say "$d"
done

echo "== 4b/6 sealing everything beside your granted directories"
# The --x on the parents stops the agent from LISTING them, but a sibling that
# is world-readable (the usual 755) is still readable if its NAME is known.
# Deny the agent explicitly on every sibling, walking UP from each granted
# directory to the home, so a whole tree like ~/Documents can be denied once and
# never touched again. Granted directories and their ancestors are skipped.
for d in "${WORK_DIRS[@]}"; do
  p="$(dirname "$d")"
  while :; do
    case "$p" in
      "$OWNER_HOME"|"$OWNER_HOME"/*) ;;
      *) break ;;
    esac
    for entry in "$p"/* "$p"/.[!.]*; do
      [ -e "$entry" ] || continue
      skip=0
      for g in "${WORK_DIRS[@]}"; do
        [ "$entry" = "$g" ] && skip=1
        case "$g" in "$entry"/*) skip=1 ;; esac
      done
      [ "$skip" -eq 1 ] && continue
      setfacl -m "u:$AGENT_USER:---" "$entry" 2>/dev/null || true
    done
    [ "$p" = "$OWNER_HOME" ] && break
    p="$(dirname "$p")"
  done
  say "sealed everything beside $d (up to $OWNER_HOME)"
done

echo "== 5/6 kit + binary for the agent"
OWNER_OPENCODE="$OWNER_HOME/.opencode/bin/opencode"
if [ -x "$OWNER_OPENCODE" ] && [ ! -x /usr/local/bin/opencode ]; then
  install -Dm755 "$OWNER_OPENCODE" /usr/local/bin/opencode
  say "installed opencode at /usr/local/bin/opencode (your copy lives in your home)"
fi
# Always refresh the agent's copy: it is locked read-only afterwards, so a stale
# copy would never pick up changes to the kit (policies, allowlist, plugins).
say "syncing the kit into $AGENT_HOME/opencode-kit"
rm -rf "$AGENT_HOME/opencode-kit"
cp -a "$KIT_DIR" "$AGENT_HOME/opencode-kit"
# Don't drag local junk / session logs into the agent's account.
rm -rf "$AGENT_HOME/opencode-kit/.pytest_cache" \
       "$AGENT_HOME/opencode-kit/.playwright-mcp" \
       "$AGENT_HOME/opencode-kit"/temp_logs*.txt
chown -R "$AGENT_USER:$AGENT_USER" "$AGENT_HOME/opencode-kit"
runuser -u "$AGENT_USER" -- "$AGENT_HOME/opencode-kit/scripts/install.sh"

# The agent's copy holds its policies, AGENTS.md and the plugins. If it owned
# them it could delete the `deny` rules and weaken its own guardrails, so the
# kit is handed to root and made read-only. Everything it still needs to write
# (state, logs, auth) lives in its own XDG data dirs, not here.
chown -R root:root "$AGENT_HOME/opencode-kit"
chmod -R a-w "$AGENT_HOME/opencode-kit"
say "kit locked read-only (root-owned): the agent cannot edit its own policies"

echo "== 6/6 done"
cat <<EOF

Next, ONCE, in this order:

  1. log the agent into its OWN account (its own login, not yours):
       sudo -u $AGENT_USER opencode
     inside it run:  /connect  ->  OpenCode Go

  2. install the launcher (as $OWNER, no sudo):
       install -Dm755 "$KIT_DIR/scripts/oc.sh" "$OWNER_HOME/.local/bin/oc"

  3. use it:
       cd ${WORK_DIRS[0]}
       oc

The agent can reach ONLY these directories (read/write):
$(printf '  %s\n' "${WORK_DIRS[@]}")

It has NO ssh key, NO cloud/DB credentials and NO push rights (also blocked by policy).
EOF
