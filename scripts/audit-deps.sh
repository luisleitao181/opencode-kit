#!/usr/bin/env bash
#
# audit-deps.sh — dependency vulnerability audit for a project.
#
# Runs pip-audit (Python) and npm audit (Node) on a project, normalises the
# findings and fails ONLY when something NEW appears relative to a baseline.
# That is what makes it usable routinely: the first run records the existing
# debt, later runs catch regressions.
#
# Usage:
#   scripts/audit-deps.sh [dir] [--strict] [--update-baseline] [--baseline FILE]
#
#   [dir]               project directory (default: current)
#   --strict            missing tooling is an error instead of a warning
#   --update-baseline   record the CURRENT findings as the baseline
#   --baseline FILE     baseline file (default: <dir>/.audit-baseline.json)
#
# Exit codes: 0 = no new findings | 1 = new findings | 2 = error/missing tooling
#
set -euo pipefail

DIR="."
STRICT=0
UPDATE=0
BASELINE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --strict) STRICT=1 ;;
    --update-baseline) UPDATE=1 ;;
    --baseline) shift; BASELINE="${1:-}" ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) DIR="$1" ;;
  esac
  shift
done

[ -d "$DIR" ] || { echo "error: '$DIR' is not a directory" >&2; exit 2; }
DIR="$(cd "$DIR" && pwd)"
BASELINE="${BASELINE:-$DIR/.audit-baseline.json}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PIPJSON=""
NPMJSON=""
PROBLEMS=0

say() { echo "  -> $*"; }

echo "== auditing $DIR"

# ── Python ────────────────────────────────────────────────────────────────
if [ -f "$DIR/requirements.txt" ] || [ -f "$DIR/pyproject.toml" ]; then
  if command -v pip-audit >/dev/null 2>&1; then
    REQS=()
    [ -f "$DIR/requirements.txt" ] && REQS=(--requirement "$DIR/requirements.txt")
    # pip-audit exits non-zero when it FINDS vulnerabilities; keep the JSON.
    ( cd "$DIR" && pip-audit -f json --progress-spinner off "${REQS[@]}" \
        > "$TMP/pip.json" 2> "$TMP/pip.err" ) || true
    if python3 -c 'import json,sys;json.load(open(sys.argv[1]))' "$TMP/pip.json" 2>/dev/null; then
      PIPJSON="$TMP/pip.json"
      say "python: pip-audit ran"
    else
      echo "  !! pip-audit produced no usable JSON:" >&2
      head -3 "$TMP/pip.err" >&2 || true
      PROBLEMS=1
    fi
  else
    echo "  !! python project but pip-audit is not installed" >&2
    echo "     install it with: python3 -m pip install --user pip-audit" >&2
    PROBLEMS=1
  fi
else
  say "python: nothing to audit (no requirements.txt / pyproject.toml)"
fi

# ── Node ──────────────────────────────────────────────────────────────────
if [ -f "$DIR/package.json" ]; then
  if [ -f "$DIR/package-lock.json" ] && command -v npm >/dev/null 2>&1; then
    # npm audit exits non-zero when it finds vulnerabilities; keep the JSON.
    ( cd "$DIR" && npm audit --json > "$TMP/npm.json" 2>/dev/null ) || true
    if python3 -c 'import json,sys;json.load(open(sys.argv[1]))' "$TMP/npm.json" 2>/dev/null; then
      NPMJSON="$TMP/npm.json"
      say "node: npm audit ran"
    else
      echo "  !! npm audit produced no usable JSON (missing lockfile or registry problem)" >&2
      PROBLEMS=1
    fi
  else
    echo "  !! package.json without package-lock.json, or npm missing" >&2
    PROBLEMS=1
  fi
else
  say "node: nothing to audit (no package.json)"
fi

# ── Normalise ─────────────────────────────────────────────────────────────
CURRENT="$TMP/current.txt"
python3 - "$PIPJSON" "$NPMJSON" > "$CURRENT" <<'PY'
import json, os, sys

def load(path):
    if not path or not os.path.exists(path):
        return None
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return None

out = []

pip = load(sys.argv[1])
deps = pip.get("dependencies", []) if isinstance(pip, dict) else (pip if isinstance(pip, list) else [])
for dep in deps or []:
    name = dep.get("name", "?")
    for v in dep.get("vulns", []) or []:
        out.append(f"pip|{name}|{v.get('id', '?')}")

npm = load(sys.argv[2])
if isinstance(npm, dict):
    for name, v in (npm.get("vulnerabilities") or {}).items():
        severity = v.get("severity", "?")
        via = v.get("via") or []
        ids = []
        for item in via:
            if isinstance(item, dict):
                ids.append(item.get("url") or item.get("title") or "advisory")
            elif isinstance(item, str):
                ids.append(item)
        for i in (ids or ["advisory"]):
            out.append(f"npm|{name}|{severity}|{i}")

for line in sorted(set(out)):
    print(line)
PY

TOTAL=$(wc -l < "$CURRENT" | tr -d ' ')
say "findings (raw): $TOTAL"

# ── Baseline ──────────────────────────────────────────────────────────────
if [ "$UPDATE" -eq 1 ]; then
  python3 - "$CURRENT" "$BASELINE" <<'PY'
import json, sys
lines = [l.rstrip("\n") for l in open(sys.argv[1]) if l.strip()]
with open(sys.argv[2], "w") as f:
    json.dump(lines, f, indent=2)
    f.write("\n")
print(f"  -> baseline written to {sys.argv[2]} ({len(lines)} findings)")
PY
  exit 0
fi

set +e
python3 - "$CURRENT" "$BASELINE" <<'PY'
import json, os, sys

current = [l.rstrip("\n") for l in open(sys.argv[1]) if l.strip()]
baseline = []
if os.path.exists(sys.argv[2]):
    try:
        baseline = json.load(open(sys.argv[2]))
    except Exception:
        baseline = []

known = [c for c in current if c in baseline]
new = [c for c in current if c not in baseline]

print(f"  -> known: {len(known)}   new: {len(new)}")
for n in new:
    print(f"NEW  {n}")
if not os.path.exists(sys.argv[2]):
    print("  (no baseline yet: everything counts as new — run with --update-baseline to accept the current debt)")
sys.exit(1 if new else 0)
PY
RC=$?
set -e

if [ "$PROBLEMS" -eq 1 ] && [ "$STRICT" -eq 1 ]; then
  echo "error: tooling problems and --strict was given" >&2
  exit 2
fi

exit "$RC"
