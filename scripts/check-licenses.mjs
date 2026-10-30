#!/usr/bin/env node
// Production-dependency license gate. Reads package-lock.json (lockfileVersion 3).
// Scope: every non-dev lock entry, plus everything reachable from the root package's
// peerDependencies (runtime for consumers even though the lock may flag them dev/peer).
// Usage: node scripts/check-licenses.mjs [--lock <path>] | --self-test
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'Unlicense',
  'Python-2.0',
]);

// GPL/AGPL/LGPL/SSPL/BUSL are not in ALLOWED, so they fail unless an OR alternative is allowed.
// Evaluate an SPDX expression: OR -> any, AND -> all. Parentheses supported.
export function allowed(expr) {
  const tokens = String(expr)
    .replace(/([()])/g, ' $1 ')
    .split(/\s+/)
    .filter(Boolean);
  let i = 0;
  const atom = () => {
    const t = tokens[i++];
    if (t === '(') {
      const v = orExpr();
      i++; // ')'
      return v;
    }
    const id = (t ?? '').replace(/\+$/, '');
    return ALLOWED.has(id);
  };
  const andExpr = () => {
    let v = atom();
    while (tokens[i] === 'AND') {
      i++;
      const r = atom();
      v = v && r;
    }
    return v;
  };
  function orExpr() {
    let v = andExpr();
    while (tokens[i] === 'OR') {
      i++;
      const r = andExpr();
      v = v || r;
    }
    return v;
  }
  return orExpr();
}

function resolveLicense(path, entry, root) {
  let lic = entry.license;
  if (!lic) {
    const pj = join(root, path, 'package.json');
    if (existsSync(pj)) {
      try {
        const j = JSON.parse(readFileSync(pj, 'utf8'));
        lic = j.license ?? j.licenses;
      } catch {
        /* ignore */
      }
    }
  }
  if (Array.isArray(lic)) lic = lic.map((l) => l.type ?? l).join(' OR ');
  if (lic && typeof lic === 'object') lic = lic.type;
  return lic ? String(lic) : 'UNKNOWN';
}

// Node-style lookup of `name` as required from lock path `from` (nested node_modules first).
function locate(packages, from, name) {
  let base = from;
  for (;;) {
    const candidate = (base ? `${base}/` : '') + `node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    const i = base.lastIndexOf('/node_modules/');
    base = i >= 0 ? base.slice(0, i) : '';
  }
}

// Lock paths reachable from the root's peerDependencies through dependencies,
// non-optional peerDependencies and optionalDependencies (when installed).
export function peerClosure(packages) {
  const rootEntry = packages[''] ?? {};
  const seen = new Set();
  const queue = [];
  const enqueue = (from, names) => {
    for (const name of names) {
      const at = locate(packages, from, name);
      if (at && !seen.has(at)) {
        seen.add(at);
        queue.push(at);
      }
    }
  };
  enqueue('', Object.keys(rootEntry.peerDependencies ?? {}));
  while (queue.length) {
    const at = queue.shift();
    const entry = packages[at];
    const optionalPeers = entry.peerDependenciesMeta ?? {};
    enqueue(at, [
      ...Object.keys(entry.dependencies ?? {}),
      ...Object.keys(entry.optionalDependencies ?? {}),
      ...Object.keys(entry.peerDependencies ?? {}).filter((n) => !optionalPeers[n]?.optional),
    ]);
  }
  return seen;
}

export function check(lockPath) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const root = dirname(resolve(lockPath));
  const packages = lock.packages ?? {};
  const peers = peerClosure(packages);
  const offenders = [];
  const counts = {};
  let n = 0;
  for (const [path, entry] of Object.entries(packages)) {
    // Workspace apps (apps/*) and their link entries are never published.
    if (path === '' || entry.link || path.startsWith('apps/')) continue;
    if (entry.dev && !peers.has(path)) continue;
    n++;
    const lic = resolveLicense(path, entry, root);
    counts[lic] = (counts[lic] ?? 0) + 1;
    if (lic === 'UNKNOWN' || !allowed(lic)) {
      offenders.push({ package: path.replace(/^.*node_modules\//, ''), license: lic });
    }
  }
  return { n, counts, offenders };
}

function run(lockPath, quiet = false) {
  const { n, counts, offenders } = check(lockPath);
  const summary = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  if (!quiet || offenders.length === 0)
    console.log(`licenses: ${n} production packages — ${summary}`);
  if (offenders.length) {
    console.error('Disallowed or unknown licenses:');
    console.table(offenders);
  }
  return offenders.length === 0;
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'licenses');
  const ok = run(join(dir, 'ok', 'package-lock.json'));
  const gplOk = run(join(dir, 'gpl', 'package-lock.json'), true);
  const gplPeerOk = run(join(dir, 'gpl-peer', 'package-lock.json'), true);
  if (ok && !gplOk && !gplPeerOk) {
    console.log(
      'self-test: ok fixture passes, gpl and gpl-peer (dev-flagged peer transitive) fixtures fail as expected',
    );
    process.exit(0);
  }
  console.error(
    `self-test FAILED (ok-pass=${ok}, gpl-fail=${!gplOk}, gpl-peer-fail=${!gplPeerOk})`,
  );
  process.exit(1);
}
const li = args.indexOf('--lock');
const lock = li >= 0 ? args[li + 1] : 'package-lock.json';
process.exit(run(lock) ? 0 : 1);
