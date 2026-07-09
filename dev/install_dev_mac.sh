#!/bin/bash

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   DopeTool DEV (Tester) Installer    ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo "This installs a SEPARATE tester panel that pulls updates"
echo "from the 'dev' branch. Your normal DopeTool panel is untouched."
echo ""

# Step 1 — Enable CEP debug mode
echo "→ Enabling CEP debug mode..."
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
defaults write com.adobe.CSXS.13 PlayerDebugMode 1
echo "  ✓ Debug mode enabled"

# Step 2 — Resolve paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # .../dev
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"                     # repo root
EXTENSIONS_PATH="$HOME/Library/Application Support/Adobe/CEP/extensions"
DEST="$EXTENSIONS_PATH/DopeToolDev"
mkdir -p "$EXTENSIONS_PATH"

echo "→ Installing DopeTool Dev to After Effects..."

if [ -d "$DEST" ]; then
  echo "  Existing tester install found — updating..."
  rm -rf "$DEST"
fi

# Step 3 — Copy the whole repo, then apply the dev overrides
mkdir -p "$DEST"
cp -R "$REPO_DIR/." "$DEST"
cp "$SCRIPT_DIR/manifest.xml"  "$DEST/CSXS/manifest.xml"
cp "$SCRIPT_DIR/.debug"        "$DEST/.debug"
cp "$SCRIPT_DIR/channel.json"  "$DEST/channel.json"

# Remove the git folder from the installed copy (not needed to run)
rm -rf "$DEST/.git"

echo "  ✓ DopeTool Dev installed (tracks 'dev' branch)"

# Step 4 — Permissions
chmod -R 755 "$DEST"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   Tester install complete! 🧪        ║"
echo "║                                      ║"
echo "║   Open After Effects and go to:      ║"
echo "║   Window → Extensions → DopeTool Dev ║"
echo "╚══════════════════════════════════════╝"
echo ""
