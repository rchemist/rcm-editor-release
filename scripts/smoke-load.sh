#!/usr/bin/env bash
# Load smoke: build + npm pack, install the tarball into a throwaway project and
# assert every published JS subpath loads via real Node resolution (ESM + CJS).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

echo "[smoke] building…"
npm run build >/dev/null

echo "[smoke] npm pack…"
TARBALL="$REPO/$(npm pack --silent)"

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP" "$TARBALL"; }
trap cleanup EXIT

cd "$TMP"
npm init -y >/dev/null 2>&1
# Required peers only; optional @rchemist/listgrid stays uninstalled.
npm i "$TARBALL" react react-dom >/dev/null 2>&1

echo "[smoke] loading published exports…"
for sub in "" /react /upload /paste /print /listgrid /docparser; do
  node -e "require('@rchemist/editor$sub'); console.log('  ok cjs  .${sub}')"
  node --input-type=module -e "await import('@rchemist/editor$sub'); console.log('  ok esm  .${sub}')"
done

test -f node_modules/@rchemist/editor/dist/styles.css && echo "  ok css  ./styles.css"

echo "[smoke] OK — published exports resolve and load"
