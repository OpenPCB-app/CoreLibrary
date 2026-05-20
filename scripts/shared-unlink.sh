#!/usr/bin/env bash
# Restore github-tag-based installs of @openpcb/* packages after shared:link.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORELIB_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

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
  echo "==> Unlinking @openpcb/$pkg"
  pkg_path="node_modules/@openpcb/$pkg"
  if [ -L "$pkg_path" ]; then
    target="$(readlink "$pkg_path")"
    real_target="$(cd "$(dirname "$pkg_path")" && cd "$(dirname "$target")" 2>/dev/null && pwd)/$(basename "$target")"
    if [[ "$real_target" == *"/shared/packages/$pkg" ]]; then
      rm -f "$pkg_path"
    fi
  fi
  npm unlink --no-save "@openpcb/$pkg" 2>/dev/null || true
done

echo ""
echo "==> Reinstalling pinned github-tag versions…"
bun install

echo ""
echo "✔ Restored github-tag installs."
