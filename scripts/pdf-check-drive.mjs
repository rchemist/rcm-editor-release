// Driver for scripts/pdf-check.sh: renders fixtures through the example PDF server
// (POST /pdf) and writes the PDFs plus a manifest for the shell verifier.
// Node >= 20, no dependencies. Usage:
//   node scripts/pdf-check-drive.mjs --server http://127.0.0.1:8788 --out /tmp/xyz
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1 || i + 1 >= process.argv.length) throw new Error(`missing ${name}`);
  return process.argv[i + 1];
}

const SERVER = arg('--server').replace(/\/+$/, '');
const OUT = arg('--out');
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const ASSET_DIRS = [
  join(ROOT, 'fixtures', 'docparser', 'assets'),
  join(ROOT, 'fixtures', 'docparser-large', 'assets'),
];

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

async function findAsset(hex) {
  for (const dir of ASSET_DIRS) {
    let names = [];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    const hit = names.find((n) => n.startsWith(hex));
    if (hit) return { bytes: await readFile(join(dir, hit)), ext: hit.slice(hit.lastIndexOf('.')) };
  }
  return null;
}

/** Replaces `asset:sha256:<hex>` strings with `data:` URLs (Chromium cannot resolve them). */
async function inlineAssets(value) {
  if (typeof value === 'string') {
    if (!value.startsWith('asset:sha256:')) return value;
    const found = await findAsset(value.slice('asset:sha256:'.length));
    if (!found || !MIME[found.ext]) throw new Error(`unresolvable asset ${value}`);
    return `data:${MIME[found.ext]};base64,${found.bytes.toString('base64')}`;
  }
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) out.push(await inlineAssets(item));
    return out;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = await inlineAssets(item);
    return out;
  }
  return value;
}

function cell(type, text) {
  return {
    type,
    attrs: { colspan: 1, rowspan: 1 },
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

/** Multi-page table: every row carries a unique marker; header repeats via thead. */
function multiPageTableDoc(rowCount) {
  const headerText = '표식머리열';
  const header = {
    type: 'tableRow',
    content: [cell('tableHeader', `${headerText}A`), cell('tableHeader', `${headerText}B`)],
  };
  const markers = [];
  const rows = [];
  for (let i = 1; i <= rowCount; i++) {
    const marker = `행고유표식-${String(i).padStart(3, '0')}`;
    markers.push(marker);
    rows.push({
      type: 'tableRow',
      content: [cell('tableCell', marker), cell('tableCell', `이어지는 본문 ${i}`)],
    });
  }
  return {
    doc: { type: 'doc', content: [{ type: 'table', content: [header, ...rows] }] },
    markers,
    headerText: `${headerText}A`,
  };
}

async function loadFixture(rel) {
  const parsed = JSON.parse(await readFile(join(ROOT, rel), 'utf8'));
  return inlineAssets(parsed.doc);
}

async function postPdf(doc, options, name) {
  const res = await fetch(`${SERVER}/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc, options }),
    signal: AbortSignal.timeout(55_000),
  });
  if (!res.ok) throw new Error(`${name}: server ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/pdf')) throw new Error(`${name}: unexpected type ${type}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error(`${name}: not a PDF`);
  await writeFile(join(OUT, name), bytes);
}

const FOOTER = '쪽 {page} / 전체 {pages}';

const paraDoc = await loadFixture(join('fixtures', 'docparser', 'synthetic-paragraph.json'));
await postPdf(paraDoc, { page: 'A4', margins: '20mm', footer: FOOTER, title: '혼합 글꼴 본문' }, 'para.pdf');

const profileDoc = await loadFixture(
  join('fixtures', 'docparser', 'profile', 'synthetic-profile.json'),
);
await postPdf(
  profileDoc,
  { page: 'A4', margins: '20mm', footer: FOOTER, title: '그림과 쪽 나눔' },
  'profile.pdf',
);

const table = multiPageTableDoc(80);
await postPdf(
  table.doc,
  { page: 'A4', margins: '20mm', footer: FOOTER, title: '여러 쪽 표' },
  'table.pdf',
);

await writeFile(
  join(OUT, 'manifest.json'),
  JSON.stringify(
    {
      cases: [
        { id: 'para', pdf: 'para.pdf', samples: ['제1장 문단 서식 시험', '가운데 정렬 문단이다.'] },
        { id: 'profile', pdf: 'profile.pdf', samples: ['첫 쪽의 본문이다.', '둘째 쪽의 첫 문단이다.'] },
        { id: 'table', pdf: 'table.pdf', samples: ['표식머리열A', '행고유표식-001'] },
      ],
      tableMarkers: table.markers,
      tableHeaderText: table.headerText,
    },
    null,
    2,
  ) + '\n',
);
console.log('pdf-check-drive: 3 PDFs written');
