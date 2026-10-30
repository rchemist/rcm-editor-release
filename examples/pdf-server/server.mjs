// Minimal PDF example server for @rchemist/editor (not part of the package).
//   POST /pdf   { doc, options?: { page, margins, header, footer, title } }
//               -> application/pdf (via Gotenberg /forms/chromium/convert/html)
//   GET  /health -> { "ok": true }
// Node >= 20, no dependencies. The print HTML comes from the built package
// (`../../dist/print.js` — run `npm run build` first); fonts come from `../../fonts`.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { extractFontRefs, rewriteFontCssBasenames, buildFormFields } from './buildRequest.mjs';

// renderPrintHtml (tiptap headless serializer + DOMParser script-strip) needs a DOM.
// jsdom (MIT) is this example's own dependency — the package itself gains no runtime dep.
{
  const dom = new JSDOM('', { pretendToBeVisual: true });
  globalThis.window ??= dom.window;
  globalThis.document ??= dom.window.document;
  globalThis.DOMParser ??= dom.window.DOMParser;
  globalThis.Node ??= dom.window.Node;
  globalThis.Element ??= dom.window.Element;
  globalThis.navigator ??= dom.window.navigator;
}
const { renderPrintHtml, fontCss } = await import('../../dist/print.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST_PRINT = join(HERE, '..', '..', 'dist', 'print.js');
const FONTS_DIR = resolve(process.env.FONTS_DIR ?? join(HERE, '..', '..', 'fonts'));
const PORT = Number(process.env.PORT ?? 8788);
const GOTENBERG_URL = (process.env.GOTENBERG_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const MAX_BYTES = Number(process.env.MAX_BYTES ?? 25 * 1024 * 1024);
// Example only: `*` lets any web page use this server as a renderer. Set ALLOW_ORIGIN and put
// authentication in front of it before any real deployment (deploy/README.md).
const ORIGIN = process.env.ALLOW_ORIGIN ?? '*';

const cors = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function send(res, status, body, headers = {}) {
  const isJson = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    ...cors,
    ...(isJson ? { 'Content-Type': 'application/json' } : {}),
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Loads repo font files referenced by `fontCss()` output; returns name -> bytes.
 * `fontCss()` refs (`fonts/noto-sans-kr/x.woff2`) are relative to the directory that
 * *contains* `fonts/`, i.e. the parent of FONTS_DIR.
 */
async function loadFontFiles(cssWithRelativeUrls) {
  const files = new Map();
  const base = resolve(FONTS_DIR, '..');
  for (const ref of extractFontRefs(cssWithRelativeUrls)) {
    const data = await readFile(join(base, ref));
    const name = ref.split('/').pop();
    if (files.has(name) && !files.get(name).equals(data)) {
      throw new Error(`font basename collision: ${name}`);
    }
    files.set(name, data);
  }
  return files;
}

async function handlePdf(req, res) {
  let parsed;
  try {
    parsed = JSON.parse((await readBody(req)).toString('utf8'));
  } catch (error) {
    send(res, error?.status === 413 ? 413 : 400, { error: 'invalid JSON body' });
    return;
  }
  if (!isRecord(parsed) || !isRecord(parsed.doc)) {
    send(res, 400, { error: 'body must be { doc, options? }' });
    return;
  }
  const options = isRecord(parsed.options) ? parsed.options : {};
  for (const key of ['page', 'margins', 'header', 'footer', 'title']) {
    const value = options[key];
    if (value !== undefined && typeof value !== 'string' && typeof value !== 'object') {
      send(res, 400, { error: `options.${key} has an unsupported type` });
      return;
    }
  }

  // Fonts always come from the repo bundle (client-supplied fontCss is ignored so the
  // multipart always carries the exact bytes the CSS references).
  const rawFontCss = fontCss();
  let fontFiles;
  try {
    fontFiles = await loadFontFiles(rawFontCss);
  } catch {
    send(res, 500, { error: `cannot read fonts from ${FONTS_DIR}` });
    return;
  }
  const printCssWithFonts = rewriteFontCssBasenames(rawFontCss);

  let printed;
  try {
    printed = renderPrintHtml(parsed.doc, {
      page: options.page,
      margins: options.margins,
      header: typeof options.header === 'string' ? options.header : undefined,
      footer: typeof options.footer === 'string' ? options.footer : undefined,
      title: typeof options.title === 'string' ? options.title : undefined,
      fontCss: printCssWithFonts,
    });
  } catch {
    send(res, 400, { error: 'cannot render print HTML for doc' });
    return;
  }

  // The pinned Chromium honors `@page` margin boxes (verified: header/footer text and
  // `counter(page)`/`counter(pages)` render), so `header`/`footer` travel in the print
  // HTML itself. Sending `header.html`/`footer.html` as well would duplicate them. The
  // print HTML already names the shipped font first and repeats table header rows.
  const indexHtml = printed.html;

  const form = new FormData();
  form.append('files', new Blob([indexHtml], { type: 'text/html' }), 'index.html');
  for (const [name, data] of fontFiles) {
    form.append('files', new Blob([data], { type: 'font/woff2' }), name);
  }
  for (const [key, value] of Object.entries(buildFormFields())) form.append(key, value);

  let upstream;
  try {
    upstream = await fetch(`${GOTENBERG_URL}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(55_000),
    });
  } catch {
    console.error(`Gotenberg unreachable at ${GOTENBERG_URL}`);
    send(res, 502, { error: 'PDF renderer unavailable' });
    return;
  }
  if (!upstream.ok) {
    const detail = (await upstream.text().catch(() => '')).slice(0, 500);
    console.error(`Gotenberg ${upstream.status}: ${detail}`);
    send(res, 502, { error: 'PDF rendering failed' });
    return;
  }
  const pdf = Buffer.from(await upstream.arrayBuffer());
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    send(res, 502, { error: 'Gotenberg did not return a PDF document' });
    return;
  }
  send(res, 200, pdf, { 'Content-Type': 'application/pdf' });
}

const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    send(res, 204, '');
    return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    send(res, 200, { ok: true });
    return;
  }
  if (req.method === 'POST' && req.url === '/pdf') {
    handlePdf(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
    });
    return;
  }
  send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`pdf-server listening on http://localhost:${PORT} (Gotenberg: ${GOTENBERG_URL})`);
});
