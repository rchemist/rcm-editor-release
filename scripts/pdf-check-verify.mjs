// Verifier for scripts/pdf-check.sh (the four PDF checks). Reads the driver manifest,
// shells out to poppler tools (or `docker exec` into the fallback container when the
// tools are absent locally), prints a summary table, exits non-zero on any failure.
// Node >= 20, no dependencies. Usage:
//   node scripts/pdf-check-verify.mjs --out DIR [--docker-exec CID]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

const OUT = arg('--out', null);
const DOCKER_CID = arg('--docker-exec', null);
if (!OUT) throw new Error('missing --out');

function run(tool, args) {
  if (DOCKER_CID) return execFileSync('docker', ['exec', DOCKER_CID, tool, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return execFileSync(tool, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

const pdfPages = (pdf) => Number(run('pdfinfo', [pdf]).match(/^Pages:\s+(\d+)/m)[1]);
const pdfPageText = (pdf, page) => run('pdftotext', ['-f', String(page), '-l', String(page), pdf, '-']);
const pdfFonts = (pdf) => run('pdffonts', [pdf]);

const failures = [];
const rows = [];
function check(ac, kase, ok, detail) {
  rows.push({ ac, kase, ok, detail });
  if (!ok) failures.push(`${ac}/${kase}: ${detail}`);
}

const manifest = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'));

// one Korean sample string per fixture present in the PDF text.
for (const kase of manifest.cases) {
  const pdf = join(OUT, kase.pdf);
  const text = run('pdftotext', [pdf, '-']);
  for (const sample of kase.samples) {
    check('text', kase.id, text.includes(sample), `sample ${JSON.stringify(sample)}`);
  }
}

// every row marker on exactly one page; header text on every page.
{
  const pdf = join(OUT, 'table.pdf');
  const pages = pdfPages(pdf);
  check('table-pages', 'table', pages >= 2, `pages=${pages} (need >= 2)`);
  const pageTexts = [];
  for (let p = 1; p <= pages; p++) pageTexts.push(pdfPageText(pdf, p));
  for (const marker of manifest.tableMarkers) {
    const hits = pageTexts.filter((t) => t.includes(marker)).length;
    if (hits !== 1) {
      check('table-pages', 'table', false, `marker ${marker} on ${hits} pages`);
      break;
    }
  }
  if (!failures.some((f) => f.startsWith('table-pages'))) {
    check('table-pages', 'table', true, `${manifest.tableMarkers.length} markers, each on 1 page`);
  }
  for (let p = 1; p <= pages; p++) {
    check(
      'table-pages',
      `table/p${p}`,
      pageTexts[p - 1].includes(manifest.tableHeaderText),
      `header ${JSON.stringify(manifest.tableHeaderText)} on page ${p}`,
    );
  }
}

// page n's text contains n (via the footer `쪽 n / 전체 N`).
for (const kase of manifest.cases) {
  const pdf = join(OUT, kase.pdf);
  const pages = pdfPages(pdf);
  for (let p = 1; p <= pages; p++) {
    const text = pdfPageText(pdf, p);
    const literal = text.includes(String(p));
    const footer = text.includes(`쪽 ${p}`);
    check('footer', `${kase.id}/p${p}`, literal && footer, `page ${p} of ${pages}`);
  }
}

// every listed font embedded, and only the bundled Noto KR families.
for (const kase of manifest.cases) {
  const pdf = join(OUT, kase.pdf);
  const lines = pdfFonts(pdf).trim().split('\n').slice(2).filter((l) => l.trim() !== '');
  check('fonts', kase.id, lines.length > 0, `${lines.length} font rows`);
  for (const line of lines) {
    const name = line.trim().split(/\s+/)[0];
    const base = name.replace(/^[A-Za-z0-9]{6}\+/, '');
    const noto = /Noto(Sans|Serif)KR/.test(base);
    const emb = /(^|\s)yes(\s|$)/.test(line);
    if (!noto || !emb) {
      check('fonts', kase.id, false, `${JSON.stringify(name)} emb=${emb ? 'yes' : 'no'}`);
      break;
    }
  }
  if (!failures.some((f) => f.startsWith(`fonts/${kase.id}`))) {
    check('fonts', kase.id, true, `${lines.length} fonts, all embedded Noto KR`);
  }
}

console.log('| check | case | result | detail |');
console.log('|---|---|---|---|');
for (const r of rows) console.log(`| ${r.ac} | ${r.kase} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.detail} |`);
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  for (const f of failures) console.log(`- ${f}`);
  process.exit(1);
}
console.log('\nAll PDF checks passed.');
