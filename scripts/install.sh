#!/usr/bin/env bash
# Installs the kit: links ./config -> ~/.config/opencode (symlinks). Linux, macOS and WSL.
set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$KIT_DIR/config"
DEST="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"

mkdir -p "$DEST"

# Items managed by the kit (files and folders inside config/)
ITEMS=(opencode.jsonc AGENTS.md agents commands skills plugins)

for item in "${ITEMS[@]}"; do
  target="$DEST/$item"
  if [ -L "$target" ]; then
    rm "$target"
  elif [ -e "$target" ]; then
    backup="$target.bak.$(date +%Y%m%d%H%M%S)"
    echo "saving existing to $backup"
    mv "$target" "$backup"
  fi
  ln -s "$SRC/$item" "$target"
  echo "linked: $target -> $SRC/$item"
done

# Machine-specific instructions are copied, not shared between operating systems.
mkdir -p "$DEST/instructions"
FACTS="$SRC/instructions/linux.local.md"
if [ ! -f "$FACTS" ]; then
  FACTS="$SRC/instructions/linux.example.md"
  echo "no linux.local.md: installing the template; fill in this machine's facts"
fi
cp "$FACTS" "$DEST/instructions/machine.md"
echo "installed: $DEST/instructions/machine.md"

echo
if ! command -v opencode >/dev/null 2>&1; then
  echo "OpenCode is not installed. Install with:"
  echo "  curl -fsSL https://opencode.ai/install | bash"
fi
echo "Just connect the provider now (keys are NOT in the repo):"
echo "  opencode  ->  /connect  ->  OpenCode Go"
echo "Then confirm models with:  opencode models"
echo
echo "Optional flair (sound + sticker): python3 $KIT_DIR/scripts/flair.py setup --sticker <file>"
