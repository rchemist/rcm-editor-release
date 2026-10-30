#!/usr/bin/env node
// Font licensing gate. Scans the repo `fonts/` directory:
//   - only allowlisted OFL family directories (each with its OFL.txt and font files),
//   - plus fonts/README.md — nothing else,
//   - and no file/directory name matching the commercial-font denylist
//     (맑은 고딕, 함초롬/HCR, 바탕/돋움/굴림/궁서, HY 계열, 윤서체, 한컴 …).
// Commercial fonts are referenced by name only in font stacks; their files never enter the repo.
// Usage: node scripts/check-fonts.mjs [--dir <path>] | --self-test
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OFL_NAME = 'OFL.txt';
const README = 'README.md';

/** Allowlisted OFL families by directory name under fonts/. */
export const ALLOWED_FAMILIES = new Map([
  ['noto-sans-kr', { ofl: OFL_NAME }],
  ['noto-serif-kr', { ofl: OFL_NAME }],
]);

const FONT_EXTENSIONS = new Set(['.woff2', '.ttf', '.otf']);

/** Commercial/redistributable-no fonts: matched case-insensitively against every path segment. */
const DENYLIST = [
  [/malgun/i, '맑은 고딕 (Microsoft)'],
  [/hcr/i, '함초롬(HCR)'],
  [/hamchorom/i, '함초롬'],
  [/함초롬/, '함초롬'],
  [/batang/i, '바탕 (Microsoft)'],
  [/바탕/, '바탕'],
  [/dotum/i, '돋움 (Microsoft)'],
  [/돋움/, '돋움'],
  [/gulim/i, '굴림 (Microsoft)'],
  [/굴림/, '굴림'],
  [/gungsuh/i, '궁서 (Microsoft)'],
  [/궁서/, '궁서'],
  [/^hy/i, 'HY 계열 상용'],
  [/한컴/, '한컴 상용'],
  [/hanyoom/i, '한컴 상용'],
  [/yoon/i, '윤서체'],
  [/윤체|윤고딕|윤명조/, '윤서체'],
];

function denyReason(segments) {
  for (const segment of segments) {
    for (const [pattern, reason] of DENYLIST) {
      if (pattern.test(segment)) return `${segment}: ${reason}`;
    }
  }
  return null;
}

const extension = (file) => file.slice(file.lastIndexOf('.')).toLowerCase();

function walk(dir, prefix = []) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const segments = [...prefix, entry.name];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path, segments));
    else out.push({ segments, path });
  }
  return out;
}

// Returns { families, fontFiles, offenders: [{ path, reason }] } — offenders empty == pass.
export function check(fontsDir) {
  const offenders = [];
  const files = walk(fontsDir);
  const families = new Set();
  let fontFiles = 0;

  for (const { segments, path } of files) {
    const rel = segments.join('/');
    const denied = denyReason(segments);
    if (denied) {
      offenders.push({ path: rel, reason: `상용 글꼴 거부목록 — ${denied}` });
      continue;
    }
    if (segments.length === 1 && segments[0] === README) continue; // fonts/README.md
    const family = ALLOWED_FAMILIES.get(segments[0]);
    if (segments.length === 2 && family) {
      if (segments[1] === family.ofl) continue; // the family's OFL.txt
      if (FONT_EXTENSIONS.has(extension(segments[1]))) {
        fontFiles++;
        families.add(segments[0]);
        continue;
      }
      offenders.push({ path: rel, reason: '허용되지 않은 확장자 (글꼴 또는 OFL.txt만)' });
      continue;
    }
    offenders.push({
      path: rel,
      reason: '허용 목록 밖 경로 (fonts/<허용 계열>/… 또는 fonts/README.md만 가능)',
    });
  }

  // Every allowlisted family directory that exists must carry its OFL.txt and a font file.
  for (const [name, family] of ALLOWED_FAMILIES) {
    const hasDir = files.some(({ segments }) => segments[0] === name && segments.length >= 2);
    if (!hasDir) continue;
    const hasOfl = files.some(({ segments }) => segments[0] === name && segments[1] === family.ofl);
    if (!hasOfl) offenders.push({ path: `${name}/${family.ofl}`, reason: 'OFL.txt 없음' });
    if (!families.has(name))
      offenders.push({ path: name, reason: '글꼴 파일 없음 (OFL.txt만 있음)' });
    const oflPath = join(fontsDir, name, family.ofl);
    if (hasOfl && readFileSync(oflPath, 'utf8').trim() === '')
      offenders.push({ path: `${name}/${family.ofl}`, reason: '빈 OFL.txt' });
  }
  if (files.length === 0) offenders.push({ path: fontsDir, reason: 'fonts/ 디렉터리가 비었음' });

  return { families: [...families], fontFiles, offenders };
}

function run(fontsDir, quiet = false) {
  const { families, fontFiles, offenders } = check(fontsDir);
  if (!quiet || offenders.length === 0)
    console.log(`fonts: ${families.length} families, ${fontFiles} font files — ${families.join(', ')}`);
  if (offenders.length) {
    console.error('Disallowed font files:');
    console.table(offenders);
  }
  return offenders.length === 0;
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fonts');
  const ok = run(join(dir, 'ok', 'fonts'));
  const commercialOk = run(join(dir, 'commercial', 'fonts'), true);
  const strayOk = run(join(dir, 'stray', 'fonts'), true);
  if (ok && !commercialOk && !strayOk) {
    console.log(
      'self-test: ok fixture passes, commercial (denylist) and stray (no OFL/extra file) fixtures fail as expected',
    );
    process.exit(0);
  }
  console.error(
    `self-test FAILED (ok-pass=${ok}, commercial-fail=${!commercialOk}, stray-fail=${!strayOk})`,
  );
  process.exit(1);
}
const i = args.indexOf('--dir');
const fontsDir = i >= 0 ? args[i + 1] : 'fonts';
process.exit(run(fontsDir) ? 0 : 1);
