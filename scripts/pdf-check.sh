#!/usr/bin/env bash
# reference check: Gotenberg PDF generation over the example server path.
#   npm run check:pdf  (run ONLY through the HARNESS gate:
#     HARNESS_TEST_ROLE=gate sh ~/.claude/locks/test_gate.sh -- npm run check:pdf)
# Renders 3 inputs (mixed-font Korean text, images/pageBreak, generated multi-page
# table) through examples/pdf-server/ -> Gotenberg, then verifies with
# pdftotext/pdffonts (local poppler-utils, or a pinned debian container running
# poppler when the tools are absent locally):
#   Korean sample strings present, row markers on exactly one
#   page + header on every page, footer page numbers, fonts
#   embedded and Noto KR only.
# Cleanup: `trap ... EXIT` stops the server and runs `compose down -v
# --remove-orphans`, so success, failure and interrupt all leave zero containers,
# volumes and networks of this run. Never touches other projects, never prunes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN_ID="pdfcheck-$(date +%s)-$$"
COMPOSE="$ROOT/deploy/compose.pdf.yaml"
OUT="$(mktemp -d "${TMPDIR:-/tmp}/pdfcheck.XXXXXX")"
SERVER_PID=""
POPPLER_CID=""
PORT=""
SRV_PORT=""
KEEP_OUT=0

fail() { echo "pdf-check: FAIL: $1" >&2; exit 1; }

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then kill "$SERVER_PID" 2>/dev/null || true; fi
  if [ -n "$POPPLER_CID" ]; then docker rm -fv "$POPPLER_CID" >/dev/null 2>&1 || true; fi
  CI_RUN_ID="$RUN_ID" GOTENBERG_PORT="$PORT" docker compose -f "$COMPOSE" -p "$RUN_ID" down -v --remove-orphans >/dev/null 2>&1 || true
  leftover_containers="$(docker ps -aq --filter "label=com.docker.compose.project=$RUN_ID" 2>/dev/null | wc -l | tr -d ' ')"
  leftover_volumes="$(docker volume ls -q --filter "label=com.docker.compose.project=$RUN_ID" 2>/dev/null | wc -l | tr -d ' ')"
  leftover_networks="$(docker network ls -q --filter "label=com.docker.compose.project=$RUN_ID" 2>/dev/null | wc -l | tr -d ' ')"
  echo "pdf-check: leftovers containers=${leftover_containers} volumes=${leftover_volumes} networks=${leftover_networks} (run ${RUN_ID})"
  if [ "$leftover_containers" != "0" ] || [ "$leftover_volumes" != "0" ] || [ "$leftover_networks" != "0" ]; then
    echo "pdf-check: FAIL: leftovers remain" >&2
    exit 1
  fi
  if [ "${KEEP_OUT:-0}" != "1" ]; then rm -rf "$OUT"; else echo "pdf-check: out kept at $OUT"; fi
}
trap cleanup EXIT

[ -f "$ROOT/dist/print.js" ] || fail "dist/print.js missing — run 'npm run build' first"
[ -f "$ROOT/fonts/noto-sans-kr/NotoSansKR-Variable.woff2" ] || fail "repo fonts missing"

PORT="$(node -e "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()});")"
SRV_PORT="$(node -e "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()});")"
export CI_RUN_ID="$RUN_ID" GOTENBERG_PORT="$PORT"

echo "pdf-check: starting Gotenberg (project $RUN_ID, port $PORT)"
docker compose -f "$COMPOSE" -p "$RUN_ID" up -d >/dev/null
deadline=$((SECONDS + 120))
while true; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/health" || echo 000)"
  if [ "$code" != "000" ]; then break; fi
  [ "$SECONDS" -lt "$deadline" ] || fail "Gotenberg not up on :$PORT"
  sleep 2
done
echo "pdf-check: Gotenberg up (HTTP $code)"

if [ ! -d "$ROOT/examples/pdf-server/node_modules/jsdom" ]; then
  echo "pdf-check: installing example server deps (jsdom, MIT)"
  npm install --prefix "$ROOT/examples/pdf-server" --no-audit --no-fund >/dev/null \
    || fail "example server npm install failed"
fi

GOTENBERG_URL="http://127.0.0.1:${PORT}" PORT="$SRV_PORT" node "$ROOT/examples/pdf-server/server.mjs" >"$OUT/server.log" 2>&1 &
SERVER_PID="$!"
deadline=$((SECONDS + 30))
while true; do
  if curl -sf "http://127.0.0.1:${SRV_PORT}/health" >/dev/null 2>&1; then break; fi
  kill -0 "$SERVER_PID" 2>/dev/null || fail "pdf-server died: $(tail -5 "$OUT/server.log")"
  [ "$SECONDS" -lt "$deadline" ] || fail "pdf-server not up on :$SRV_PORT"
  sleep 1
done
echo "pdf-check: example server up (port $SRV_PORT)"

node "$ROOT/scripts/pdf-check-drive.mjs" --server "http://127.0.0.1:${SRV_PORT}" --out "$OUT"

VERIFY_ARGS="--out $OUT"
if ! (command -v pdftotext >/dev/null && command -v pdffonts >/dev/null && command -v pdfinfo >/dev/null); then
  echo "pdf-check: local poppler missing — using pinned container fallback"
  POPPLER_IMAGE="docker.io/library/debian:bookworm-slim@sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3"
  POPPLER_CID="$(docker run -d --label "ci.run=${RUN_ID}" -v "${OUT}:${OUT}" "$POPPLER_IMAGE" sleep infinity)"
  docker exec "$POPPLER_CID" sh -c 'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -qy poppler-utils >/dev/null' \
    || fail "poppler install in fallback container failed"
  VERIFY_ARGS="--out $OUT --docker-exec $POPPLER_CID"
fi

# shellcheck disable=SC2086
if node "$ROOT/scripts/pdf-check-verify.mjs" $VERIFY_ARGS; then
  echo "pdf-check: PASS"
else
  KEEP_OUT=1
  fail "verification failed (out kept at $OUT)"
fi
