#!/usr/bin/env bash
# Consumer smoke (local heavy — run through the test gate):
#   build -> npm pack -> for each examples/consumer-* app: copy to a temp dir, npm install the
#   tarball (no aliases, no file: links to this repo), prove single @tiptap/pm + @tiptap/core
#   installs, production build, serve, (Next) curl the SSR HTML, Playwright check.
# Then a tiptap version-drift scenario (examples/consumer-drift pins an older starter-kit):
#   drifted install -> duplicate copies + one RCM_EDITOR_TIPTAP_DUPLICATE warning (dev build),
#   then npm overrides to TIPTAP_VERSION -> single copy + no warning.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
APPS=(consumer-vite-react18 consumer-vite-react19 consumer-next-app consumer-vanilla)
SINGLE_COPY=(@tiptap/pm @tiptap/core)
export NEXT_TELEMETRY_DISABLED=1

WORK="$(mktemp -d "${TMPDIR:-/tmp}/rcm-consumer-smoke.XXXXXX")"
TARBALL=""
SERVER_PID=""
ROWS=()

kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null || true
}
stop_server() {
  if [ -n "$SERVER_PID" ]; then
    kill_tree "$SERVER_PID"
    wait "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=""
  fi
}
cleanup() {
  stop_server
  case "$WORK" in */rcm-consumer-smoke.*) rm -rf -- "$WORK" ;; esac
  if [ -n "$TARBALL" ]; then rm -f -- "$TARBALL"; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

free_port() {
  node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"
}
wait_http() {
  local url="$1" i
  for i in $(seq 1 120); do
    curl -fsS -o /dev/null "$url" 2>/dev/null && return 0
    kill -0 "$SERVER_PID" 2>/dev/null || return 1
    sleep 0.5
  done
  return 1
}
fail() {
  echo "[consumer] FAIL ($1): $2" >&2
  if [ -n "${3:-}" ] && [ -f "$3" ]; then tail -n 60 "$3" >&2; fi
  exit 1
}

cd "$REPO"
echo "[consumer] building + packing…"
npm run build >"$WORK/build.log" 2>&1 || fail build "npm run build" "$WORK/build.log"
TARBALL="$REPO/$(npm pack --silent 2>/dev/null | tail -n 1)"
cp "$TARBALL" "$WORK/rchemist-editor.tgz"

copy_app() { # <example> <dest>
  mkdir -p "$2"
  (cd "$REPO/examples/$1" && tar --exclude node_modules --exclude .next --exclude dist -cf - .) |
    (cd "$2" && tar -xf -)
}
install_app() { # <dir> <log>
  (cd "$1" && npm install --no-audit --no-fund --loglevel=error "$WORK/rchemist-editor.tgz") >>"$2" 2>&1
}
# Sets COPIES (number of distinct install paths) and VERSION (distinct versions) for <pkg> in <dir>.
count_copies() { # <dir> <pkg> <log>
  local paths
  paths="$(cd "$1" && npm ls "$2" --all --parseable 2>>"$3" | grep "/node_modules/$2\$" | sort -u || true)"
  COPIES="$(printf '%s\n' "$paths" | grep -c . || true)"
  VERSION="$(cd "$1" && npm ls "$2" --all --json 2>/dev/null | node -e '
    const seen = new Set();
    const walk = (d) => Object.entries(d.dependencies ?? {}).forEach(([n, v]) => {
      if (n === process.argv[1] && v.version) seen.add(v.version);
      walk(v);
    });
    walk(JSON.parse(require("fs").readFileSync(0, "utf8")));
    console.log([...seen].sort().join("+") || "?");' "$2")"
  echo "  $2: $COPIES install path(s) [$VERSION]: $(printf '%s ' $paths | sed "s#[^ ]*/$(basename "$1")/##g")"
  (cd "$1" && npm ls "$2" --all) >>"$3" 2>&1 || true
}
serve_app() { # <app> <dir> <log>; sets URL
  local port
  port="$(free_port)"
  URL="http://127.0.0.1:$port"
  case "$1" in
    consumer-next-app)
      (cd "$2" && exec node node_modules/next/dist/bin/next start -H 127.0.0.1 -p "$port") >>"$3" 2>&1 &
      ;;
    *)
      (cd "$2" && exec node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port "$port" --strictPort) >>"$3" 2>&1 &
      ;;
  esac
  SERVER_PID=$!
  wait_http "$URL/" || fail "$1" "server did not answer at $URL" "$3"
}
run_playwright() { # <spec-filter> <out-name> <log> [ENV=VAL…]
  local filter="$1" out="$2" log="$3"
  shift 3
  env "$@" CONSUMER_URL="$URL" CONSUMER_OUTPUT_DIR="$WORK/pw-$out" \
    npx playwright test -c examples/consumer.playwright.config.ts "$filter" >>"$log" 2>&1
}

for app in "${APPS[@]}"; do
  dir="$WORK/$app"
  log="$WORK/$app.log"
  echo "[consumer] $app: install"
  copy_app "$app" "$dir"
  install_app "$dir" "$log" || fail "$app" "npm install" "$log"
  if grep -q -- "$REPO" "$dir/package.json" "$dir/package-lock.json"; then
    fail "$app" "consumer manifest/lock references the source repo"
  fi

  copies=""
  for pkg in "${SINGLE_COPY[@]}"; do
    count_copies "$dir" "$pkg" "$log"
    [ "$COPIES" = 1 ] || fail "$app" "$pkg resolved to $COPIES install paths" "$log"
    copies="$copies $pkg@$VERSION x$COPIES"
  done

  echo "[consumer] $app: build"
  (cd "$dir" && npm run build) >>"$log" 2>&1 || fail "$app" "build" "$log"
  serve_app "$app" "$dir" "$log"

  ssr="n/a"
  if [ "$app" = consumer-next-app ]; then
    code="$(curl -sS -o "$WORK/next.html" -w '%{http_code}' "$URL/")"
    [ "$code" = 200 ] || fail "$app" "SSR HTTP $code"
    grep -q 'data-rcm-editor' "$WORK/next.html" || fail "$app" "SSR HTML lacks data-rcm-editor"
    ssr="200+data-rcm-editor"
  fi

  spec='consumer\.spec'
  if [ "$app" = consumer-vanilla ]; then spec='vanilla\.spec'; fi
  echo "[consumer] $app: playwright"
  run_playwright "$spec" "$app" "$log" || fail "$app" "playwright" "$log"
  stop_server

  ROWS+=("$app|ok|${copies# }|$ssr|ok")
done

# --- tiptap version drift -------------------------------------------------------------------
app=consumer-drift
dir="$WORK/$app"
log="$WORK/$app.log"
TV="$(node --input-type=module -e "import { tiptapVersion } from '$REPO/scripts/tiptap-version.mjs'; console.log(tiptapVersion())")"
DRIFT_ROWS=()
# Development build so the dev-only warning is active (vite build defaults NODE_ENV=production).
dev_build() { (cd "$dir" && NODE_ENV=development node node_modules/vite/bin/vite.js build) >>"$log" 2>&1; }

echo "[consumer] $app: drifted install (starter-kit pinned older than $TV)"
copy_app "$app" "$dir"
if install_app "$dir" "$log"; then
  count_copies "$dir" @tiptap/core "$log"
  core="$COPIES [$VERSION]"
  [ "$COPIES" -ge 2 ] || fail "$app" "drift did not duplicate @tiptap/core (scenario invalid)" "$log"
  count_copies "$dir" @tiptap/pm "$log"
  pm="$COPIES [$VERSION]"
  dev_build || fail "$app" "dev build (drift)" "$log"
  serve_app "$app" "$dir" "$log"
  echo "[consumer] $app: playwright (expect 1 duplicate warning)"
  run_playwright 'drift\.spec' drift "$log" CONSUMER_EXPECT_DUPLICATE_WARNINGS=1 ||
    fail "$app" "playwright (drift)" "$log"
  stop_server
  grep '\[drift\]' "$log" | sed 's/^/  /' | cut -c1-260
  editing="$(sed -n 's/.*\[drift\] editing=\(.*\) errors=.*/\1/p' "$log" | tail -n 1)"
  DRIFT_ROWS+=("drifted|core=$core pm=$pm|1 warning|$editing")
elif grep -q ERESOLVE "$log"; then
  echo "  npm refused the drifted install (ERESOLVE)"
  DRIFT_ROWS+=("drifted|ERESOLVE (npm refused)|n/a|n/a")
else
  fail "$app" "npm install (drift)" "$log"
fi

echo "[consumer] $app: npm overrides -> @tiptap/core,pm = $TV"
node -e '
  const [f, v] = process.argv.slice(1), fs = require("fs");
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  j.overrides = { "@tiptap/core": v, "@tiptap/pm": v };
  fs.writeFileSync(f, JSON.stringify(j, null, 2));' "$dir/package.json" "$TV"
case "$dir" in "$WORK"/*) rm -rf -- "$dir/node_modules" "$dir/package-lock.json" ;; esac
install_app "$dir" "$log" || fail "$app" "npm install (overrides)" "$log"
for pkg in "${SINGLE_COPY[@]}"; do
  count_copies "$dir" "$pkg" "$log"
  [ "$COPIES" = 1 ] || fail "$app" "overrides: $pkg still has $COPIES install paths" "$log"
done
dev_build || fail "$app" "dev build (overrides)" "$log"
serve_app "$app" "$dir" "$log"
echo "[consumer] $app: playwright (expect no duplicate warning)"
run_playwright 'drift\.spec' aligned "$log" CONSUMER_EXPECT_DUPLICATE_WARNINGS=0 ||
  fail "$app" "playwright (overrides)" "$log"
stop_server
DRIFT_ROWS+=("overrides|core=1 [$TV] pm=1 [$TV]|0 warnings|typing works")

echo
printf '%-24s %-6s %-44s %-20s %-10s\n' APP BUILD SINGLE-COPY SSR PLAYWRIGHT
for row in "${ROWS[@]}"; do
  IFS='|' read -r a b c s p <<<"$row"
  printf '%-24s %-6s %-44s %-20s %-10s\n' "$a" "$b" "$c" "$s" "$p"
done
echo
printf '%-10s %-44s %-12s %-24s\n' DRIFT INSTALL WARNING EDITOR
for row in "${DRIFT_ROWS[@]}"; do
  IFS='|' read -r a b c d <<<"$row"
  printf '%-10s %-44s %-12s %-24s\n' "$a" "$b" "$c" "$d"
done
echo "[consumer] OK — ${#ROWS[@]} consumer apps + drift scenario"
