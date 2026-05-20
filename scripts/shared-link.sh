#!/usr/bin/env bash
# Link CoreLibrary's node_modules to the local checkout of github.com/OpenPCB-app/shared.
# Expects sibling ../shared; override with SHARED_DIR=/path/to/shared.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORELIB_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SHARED_DIR="${SHARED_DIR:-$(cd "$CORELIB_ROOT/../shared" && pwd)}"

if [ ! -d "$SHARED_DIR/packages" ]; then
  echo "ERROR: $SHARED_DIR does not look like the shared/ monorepo (no packages/)" >&2
  echo "       Clone github.com/OpenPCB-app/shared next to CoreLibrary, or set SHARED_DIR." >&2
  exit 1
fi

PACKAGES=(
  kicad-parsers
  rendering-core
  kicad-import
  step-to-glb
  r3f-eda-canvas
  opclib-pack
  command-pattern
  contracts
)

cd "$CORELIB_ROOT"

for pkg in "${PACKAGES[@]}"; do
  if [ ! -d "$SHARED_DIR/packages/$pkg/dist" ]; then
    echo "==> Building @openpcb/$pkg (dist/ missing)…"
    (cd "$SHARED_DIR/packages/$pkg" && npm run build)
  fi
  echo "==> Registering @openpcb/$pkg from $SHARED_DIR/packages/$pkg"
  (cd "$SHARED_DIR/packages/$pkg" && npm link --no-audit)
  echo "==> Linking @openpcb/$pkg into CoreLibrary"
  if ! npm link --no-audit "@openpcb/$pkg"; then
    echo "    npm link failed with this Bun node_modules layout; creating direct symlink fallback."
    mkdir -p "node_modules/@openpcb"
    rm -rf "node_modules/@openpcb/$pkg"
    ln -s "$SHARED_DIR/packages/$pkg" "node_modules/@openpcb/$pkg"
  fi
done

echo ""
echo "✔ All 8 @openpcb/* packages now point at $SHARED_DIR/packages/*"
echo ""
echo "Tip: run \`cd $SHARED_DIR && npm run dev\` to keep dist/ rebuilt on source edits."
echo "Tip: run \`npm run shared:unlink\` to restore github-tag installs."
