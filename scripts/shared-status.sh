#!/usr/bin/env bash
# Show whether each @openpcb/* package is linked or installed from dependencies.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORELIB_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$CORELIB_ROOT"

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

printf "%-28s  %s\n" "package" "source"
printf "%-28s  %s\n" "----------------------------" "----------------------------------"

for pkg in "${PACKAGES[@]}"; do
  pkg_path="node_modules/@openpcb/$pkg"
  if [ -L "$pkg_path" ]; then
    target="$(readlink "$pkg_path")"
    real_target="$(cd "$(dirname "$pkg_path")" && cd "$(dirname "$target")" 2>/dev/null && pwd)/$(basename "$target")"
    if [[ "$real_target" == *"/shared/packages/$pkg" ]]; then
      printf "%-28s  linked → %s\n" "@openpcb/$pkg" "$target"
    else
      version="$(node -p "require('./$pkg_path/package.json').version" 2>/dev/null || echo "?")"
      printf "%-28s  installed symlink (v%s) → %s\n" "@openpcb/$pkg" "$version" "$target"
    fi
  elif [ -d "$pkg_path" ]; then
    version="$(node -p "require('./$pkg_path/package.json').version" 2>/dev/null || echo "?")"
    printf "%-28s  installed (v%s)\n" "@openpcb/$pkg" "$version"
  else
    printf "%-28s  NOT INSTALLED\n" "@openpcb/$pkg"
  fi
done
