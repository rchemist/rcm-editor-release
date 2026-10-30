#!/usr/bin/env node
// the package holds no cloud credentials or SDKs; no client-side
// rasterizers (html2canvas, html2pdf.js, jspdf — PDF is server Chromium only). Fails when
//   - package.json lists aws-sdk, @aws-sdk/*, @google-cloud/* or a rasterizer in any dependency field,
//   - package-lock.json contains such a package anywhere in the tree,
//   - a built bundle in dist/ references them (import/require/specifier),
//   - src/upload or the built upload typings have a secret-key style option name.
// Usage: node scripts/check-no-cloud-sdk.mjs [--require-dist] | --self-test
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const FORBIDDEN = /^(aws-sdk|@aws-sdk\/.+|@google-cloud\/.+|html2canvas|html2pdf\.js|jspdf)$/;
const SPECIFIER = /['"`](aws-sdk|@aws-sdk\/[^'"`]+|@google-cloud\/[^'"`]+|html2canvas|html2pdf\.js|jspdf)(?:\/[^'"`]*)?['"`]/;
const SECRET_FIELD = /\b(secretAccessKey|accessKeyId|secretKey|secret_access_key|awsSecret|serviceAccountKey|privateKey)\b/;

/** Forbidden package names listed in a package.json object. */
export function forbiddenInPackageJson(pkg) {
  const found = [];
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(pkg[field] ?? {})) if (FORBIDDEN.test(name)) found.push(`${field}: ${name}`);
  }
  return found;
}

/** Forbidden packages in a lockfileVersion 2/3 `packages` map. */
export function forbiddenInLock(lock) {
  const found = [];
  for (const key of Object.keys(lock.packages ?? {})) {
    const name = key.split('node_modules/').pop() ?? '';
    const scoped = key.match(/node_modules\/(@[^/]+\/[^/]+)$/);
    const candidate = scoped ? scoped[1] : name;
    if (candidate && FORBIDDEN.test(candidate)) found.push(`lock: ${key}`);
  }
  return found;
}

/** Lines of `source` that name a forbidden package as a module specifier. */
export function forbiddenSpecifiers(source) {
  const found = [];
  for (const line of source.split('\n')) {
    const m = SPECIFIER.exec(line);
    if (m && /(import|require|from)\b/.test(line)) found.push(m[1]);
  }
  return found;
}

function walk(dir, accept, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, accept, out);
    else if (accept(path)) out.push(path);
  }
  return out;
}

function selfTest() {
  const assert = (cond, msg) => {
    if (!cond) {
      console.error(`self-test failed: ${msg}`);
      process.exit(1);
    }
  };
  assert(forbiddenInPackageJson({ dependencies: { '@aws-sdk/client-s3': '1' } }).length === 1, 'aws-sdk v3 dep');
  assert(forbiddenInPackageJson({ devDependencies: { 'aws-sdk': '1' } }).length === 1, 'aws-sdk v2 dep');
  assert(forbiddenInPackageJson({ dependencies: { '@google-cloud/storage': '1' } }).length === 1, 'gcs dep');
  assert(forbiddenInPackageJson({ dependencies: { '@tiptap/core': '1' } }).length === 0, 'clean dep');
  assert(forbiddenInPackageJson({ dependencies: { html2canvas: '1' } }).length === 1, 'rasterizer dep');
  assert(forbiddenInLock({ packages: { 'node_modules/x/node_modules/jspdf': {} } }).length === 1, 'nested jspdf');
  assert(forbiddenSpecifiers("import h from 'html2pdf.js';").length === 1, 'rasterizer import');
  assert(forbiddenInLock({ packages: { 'node_modules/a/node_modules/@aws-sdk/x': {} } }).length === 1, 'nested lock');
  assert(forbiddenInLock({ packages: { 'node_modules/aws-sdk-mock-not': {} } }).length === 0, 'similar name');
  assert(forbiddenSpecifiers('import x from "@aws-sdk/client-s3";').length === 1, 'import specifier');
  assert(forbiddenSpecifiers('const a = require("aws-sdk");').length === 1, 'require specifier');
  assert(forbiddenSpecifiers('// presigned S3 uploads, no aws-sdk here').length === 0, 'prose mention');
  console.log('check-no-cloud-sdk self-test OK');
}

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

const problems = [];
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
problems.push(...forbiddenInPackageJson(readJson(join(root, 'package.json'))));
const lockPath = join(root, 'package-lock.json');
if (existsSync(lockPath)) problems.push(...forbiddenInLock(readJson(lockPath)));

const distDir = join(root, 'dist');
if (existsSync(distDir)) {
  const bundles = walk(distDir, (p) => /\.(c|m)?js$/.test(p));
  for (const file of bundles)
    for (const name of forbiddenSpecifiers(readFileSync(file, 'utf8')))
      problems.push(`dist: ${file.slice(root.length + 1)} imports ${name}`);
  const typings = walk(distDir, (p) => /upload.*\.d\.c?ts$/.test(p));
  for (const file of typings)
    if (SECRET_FIELD.test(readFileSync(file, 'utf8')))
      problems.push(`dist: ${file.slice(root.length + 1)} has a secret-key style option`);
} else if (process.argv.includes('--require-dist')) {
  problems.push('dist/ is missing: run npm run build first');
} else {
  console.warn('check-no-cloud-sdk: dist/ not found, bundle scan skipped (run after npm run build)');
}

for (const file of walk(join(root, 'src', 'upload'), (p) => p.endsWith('.ts')))
  if (SECRET_FIELD.test(readFileSync(file, 'utf8')))
    problems.push(`src: ${file.slice(root.length + 1)} has a secret-key style option`);

if (problems.length) {
  console.error('check-no-cloud-sdk FAILED:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('check-no-cloud-sdk OK: no cloud SDK or rasterizer in dependencies, lockfile or dist bundles');
