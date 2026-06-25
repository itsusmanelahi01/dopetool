#!/bin/bash

echo ""
echo "╔══════════════════════════════════════╗"
echo "║     DopeTool Installer for Mac       ║"
echo "╚══════════════════════════════════════╝"
echo ""

# Step 1 — Enable debug mode
echo "→ Enabling CEP debug mode..."
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
echo "  ✓ Debug mode enabled"

# Step 2 — Create extensions folder if it doesn't exist
EXTENSIONS_PATH="$HOME/Library/Application Support/Adobe/CEP/extensions"
mkdir -p "$EXTENSIONS_PATH"

# Step 3 — Copy DopeTool folder
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$EXTENSIONS_PATH/DopeTool"

echo "→ Installing DopeTool to After Effects..."

if [ -d "$DEST" ]; then
  echo "  Existing installation found — updating..."
  rm -rf "$DEST"
fi

cp -r "$SCRIPT_DIR" "$DEST"
echo "  ✓ DopeTool installed"

# Step 4 — Set permissions
chmod -R 755 "$DEST"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   Installation complete! 🎉          ║"
echo "║                                      ║"
echo "║   Open After Effects and go to:      ║"
echo "║   Window → Extensions → DopeTool     ║"
echo "╚══════════════════════════════════════╝"
echo ""
