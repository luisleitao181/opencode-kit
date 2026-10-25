#!/usr/bin/env bash
# scripts/secure-commit.sh
# Installs a pre-commit hook that scans staged changes for likely secrets.
#
# Usage:
#   scripts/secure-commit.sh [<repo-path>]
#
# If <repo-path> is omitted the current directory is used. The hook works
# offline and has no mandatory dependencies; if gitleaks or detect-secrets is
# on PATH it is used as an additional pass.

set -euo pipefail

REPO_PATH="${1:-.}"
cd -- "$REPO_PATH"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "Error: $(pwd) is not a git repository." >&2
    exit 1
fi

GIT_DIR=$(git rev-parse --git-dir)
HOOK_DIR="$GIT_DIR/hooks"
PRE_COMMIT="$HOOK_DIR/pre-commit"
BACKUP="$PRE_COMMIT.preopencode"
MARKER="# OPENCODE-SECRET-SCANNER"

mkdir -p "$HOOK_DIR"

# If a pre-commit hook already exists and is not ours, back it up once.
if [ -f "$PRE_COMMIT" ] && ! grep -q "$MARKER" "$PRE_COMMIT"; then
    if [ ! -f "$BACKUP" ]; then
        cp "$PRE_COMMIT" "$BACKUP"
        echo "Backed up existing pre-commit hook to $BACKUP"
    else
        echo "Existing pre-commit hook already backed up at $BACKUP"
    fi
elif [ -f "$PRE_COMMIT" ]; then
    echo "Replacing existing OpenCode secret-scanner pre-commit hook at $PRE_COMMIT"
else
    echo "Installing new pre-commit hook at $PRE_COMMIT"
fi

cat > "$PRE_COMMIT" <<'PYEOF'
#!/usr/bin/env bash
# OPENCODE-SECRET-SCANNER
set -euo pipefail

python3 - "$@" <<'PYINNER'
import json
import os
import re
import shutil
import subprocess
import sys

RED = "\033[0;31m"
RESET = "\033[0m"


def run(cmd, **kwargs):
    return subprocess.run(cmd, capture_output=True, text=True, **kwargs)


def get_staged_files():
    result = run(["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR"])
    if result.returncode != 0:
        return []
    return [f for f in result.stdout.splitlines() if f]


def is_binary(path):
    result = run(["git", "diff", "--cached", "--numstat", "--", path])
    if result.returncode != 0 or not result.stdout.strip():
        return False
    parts = result.stdout.strip().split("\t")
    return len(parts) == 3 and parts[0] == "-" and parts[1] == "-"


def get_staged_text(path):
    result = run(["git", "show", f":{path}"])
    if result.returncode != 0:
        return None
    return result.stdout


PATTERNS = [
    ("AWS access key ID", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"), None),
    (
        "private key header",
        re.compile(r"-----BEGIN\s+(?:RSA\s+|DSA\s+|EC\s+|OPENSSH\s+|PGP\s+)?PRIVATE\s+KEY-----"),
        None,
    ),
    (
        "GitHub/Slack token",
        re.compile(
            r"(?:ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}|xox[baprs]-[0-9]{10,13}-[0-9]{10,13}(?:-[a-zA-Z0-9]{24})?)"
        ),
        None,
    ),
    (
        "generic secret assignment",
        re.compile(
            r"(?i)(?:api[_-]?key|secret[_-]?key|secret|token|password)\s*[:=]\s*[\"']?([A-Za-z0-9_+\-/]{16,})[\"']?"
        ),
        "generic",
    ),
]

# Obvious placeholders: blocking a commit on these would push people to
# `git commit --no-verify`, which is worse than not having the hook.
PLACEHOLDER = re.compile(
    r"(?i)(example|placeholder|changeme|dummy|your[_-]|xxxx|aaaa|0000|sample|redacted|fake)"
)


def looks_like_secret(value):
    if PLACEHOLDER.search(value):
        return False
    if len(value) < 16:
        return False
    return any(c.isdigit() for c in value) and any(c.isalpha() for c in value)

SENSITIVE_NAME_PATTERNS = [
    re.compile(r"^\.env(?!\.example$)"),
    re.compile(r"\.pem$"),
    re.compile(r"\.key$"),
    re.compile(r"\.p12$"),
    re.compile(r"\.jks$"),
    re.compile(r"^id_rsa"),
    re.compile(r"^credentials\.json$"),
    re.compile(r"^service-account.*\.json$"),
]


def filename_is_sensitive(name):
    base = os.path.basename(name)
    return any(p.search(base) for p in SENSITIVE_NAME_PATTERNS)


def scan_text(path, text, findings):
    for label, regex, validator in PATTERNS:
        for match in regex.finditer(text):
            if validator == "generic" and not looks_like_secret(match.group(1)):
                continue
            start = max(match.start() - 20, 0)
            end = min(match.end() + 20, len(text))
            snippet = text[start:end].replace("\n", " ").strip()
            findings.append((path, label, snippet))


def run_external(name, cmd, parse_json_results=False):
    if not shutil.which(name):
        return None
    proc = run(cmd)
    if parse_json_results:
        try:
            data = json.loads(proc.stdout)
            if data.get("results"):
                return f"{name} reported findings in {len(data['results'])} file(s)"
        except json.JSONDecodeError:
            if proc.returncode != 0:
                return proc.stdout or proc.stderr or f"{name} exited {proc.returncode}"
        return None
    if proc.returncode != 0:
        return proc.stdout or proc.stderr or f"{name} exited {proc.returncode}"
    return None


def main():
    findings = []
    staged = get_staged_files()
    if not staged:
        return 0

    for path in staged:
        if filename_is_sensitive(path):
            findings.append(
                (path, "sensitive filename", "staged file name matches secret-related pattern")
            )

        if not is_binary(path):
            text = get_staged_text(path)
            if text:
                scan_text(path, text, findings)

    external = []
    gitleaks_out = run_external("gitleaks", ["gitleaks", "protect", "--staged", "--verbose"])
    if gitleaks_out:
        external.append(gitleaks_out)

    detectsec_out = run_external(
        "detect-secrets", ["detect-secrets", "scan", *staged], parse_json_results=True
    )
    if detectsec_out:
        external.append(detectsec_out)

    if findings:
        print(
            f"{RED}BLOCKED: likely secrets detected in staged changes.{RESET}",
            file=sys.stderr,
        )
        print("Review or unstage these files before committing:\n", file=sys.stderr)
        for path, label, snippet in findings:
            print(f"  {path}  |  {label}", file=sys.stderr)
            if snippet:
                print(f"    ... {snippet} ...", file=sys.stderr)
        print(file=sys.stderr)
        print("Remove or unstage the secret before committing.", file=sys.stderr)
        return 1

    if external:
        print(
            f"{RED}BLOCKED: external secret scanner reported findings.{RESET}",
            file=sys.stderr,
        )
        for block in external:
            print(f"  - {block}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
PYINNER

# Chain to the previously-installed pre-commit hook, if it was backed up.
PRE_COMMIT_PREOPENCODE="${BASH_SOURCE[0]}.preopencode"
if [ -f "$PRE_COMMIT_PREOPENCODE" ]; then
    if [ -x "$PRE_COMMIT_PREOPENCODE" ]; then
        exec "$PRE_COMMIT_PREOPENCODE" "$@"
    else
        bash "$PRE_COMMIT_PREOPENCODE" "$@"
    fi
fi
PYEOF

chmod +x "$PRE_COMMIT"
echo "Installed secret-scanning pre-commit hook at $PRE_COMMIT"
