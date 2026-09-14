#!/usr/bin/env bash
# Regenerate the derived brand assets from this system's own master.
#
# assets/logo.jpg is the master and lives here — this script reaches outside the
# design system only if you explicitly point it somewhere with --from.
#
#   ./tools/sync-assets.sh                 regenerate from assets/logo.jpg
#   ./tools/sync-assets.sh --from <dir>    import a new master, then regenerate
#
# <dir> must contain logo.jpg and favicon.png.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src=""

while [ $# -gt 0 ]; do
  case "$1" in
    --from) src="${2:?--from needs a directory}"; shift 2 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1"; exit 1 ;;
  esac
done

command -v sips >/dev/null || { echo "error: sips not found (macOS only)"; exit 1; }
mkdir -p "$here/assets" "$here/tailwind/assets"

if [ -n "$src" ]; then
  for f in logo.jpg favicon.png; do
    [ -f "$src/$f" ] || { echo "error: $src/$f missing"; exit 1; }
  done
  cp "$src/logo.jpg"    "$here/assets/logo.jpg"
  cp "$src/favicon.png" "$here/assets/favicon.png"
  echo "Imported master from $src"
fi

[ -f "$here/assets/logo.jpg" ] || { echo "error: assets/logo.jpg missing — pass --from <dir>"; exit 1; }

# The master is 2251px square; nothing renders it above 48px. Derived sizes are
# generated, never hand-made, so they cannot drift from the master.
sips -Z 128 "$here/assets/logo.jpg" --out "$here/assets/logo-128.png" --setProperty format png >/dev/null
sips -Z 64  "$here/assets/logo.jpg" --out "$here/assets/logo-64.png"  --setProperty format png >/dev/null

# The explorer is served from tailwind/, which cannot reach ../assets —
# a static server will not traverse above its root. It keeps its own copy.
for f in favicon.png logo.jpg logo-128.png logo-64.png; do
  cp "$here/assets/$f" "$here/tailwind/assets/$f"
done

echo "Brand assets regenerated"
for f in "$here/assets"/*; do
  printf "  %-16s %7s bytes\n" "$(basename "$f")" "$(stat -f%z "$f")"
done
