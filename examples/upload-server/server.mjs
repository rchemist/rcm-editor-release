// Minimal upload receiver for @rchemist/editor (example, not part of the package or CI).
//   POST /upload   multipart/form-data, field "file"  ->  { "url": "http://localhost:8787/files/<name>" }
//   POST /presign  { name, type }                     ->  { url, method: "PUT", headers, src }   (needs S3_* env)
//   GET  /files/*  serves uploaded files
// Node >= 20, no dependencies.
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extname, join, resolve } from 'node:path';
import { presignQuery } from './sigv4.mjs';

const PORT = Number(process.env.PORT ?? 8787);
const PUBLIC = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;
const DIR = resolve(process.env.UPLOAD_DIR ?? './uploads');
const MAX_BYTES = Number(process.env.MAX_BYTES ?? 20 * 1024 * 1024);
const ORIGIN = process.env.ALLOW_ORIGIN ?? '*'; // set to your app's origin in real use

// MinIO / S3 (only for /presign). The browser never sees these.
const S3 = {
  endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  bucket: process.env.S3_BUCKET ?? 'editor-assets',
  region: process.env.S3_REGION ?? 'us-east-1',
  accessKey: process.env.S3_ACCESS_KEY,
  secretKey: process.env.S3_SECRET_KEY,
  publicBase: process.env.S3_PUBLIC_BASE, // e.g. a CDN or a public-read bucket URL
};

const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

const cors = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Playground',
};

function send(res, status, body, headers = {}) {
  const json = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, { ...cors, ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers });
  res.end(json ? JSON.stringify(body) : body);
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

/** First part named `file`: { filename, type, data }. */
function parseMultipart(body, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? '');
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const headerStart = start + delimiter.length + 2; // skip CRLF after the delimiter
    const headerEnd = body.indexOf('\r\n\r\n', headerStart);
    if (headerEnd === -1) return null;
    const header = body.subarray(headerStart, headerEnd).toString('utf8');
    const next = body.indexOf(delimiter, headerEnd);
    if (next === -1) return null;
    if (/name="file"/.test(header)) {
      return {
        filename: /filename="([^"]*)"/.exec(header)?.[1] ?? 'file',
        type: /content-type:\s*([^\r\n]+)/i.exec(header)?.[1]?.trim() ?? 'application/octet-stream',
        data: body.subarray(headerEnd + 4, next - 2), // drop the CRLF before the next delimiter
      };
    }
    start = next;
  }
  return null;
}

const safeName = (name) => `${randomUUID()}${extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '')}`;

async function handleUpload(req, res) {
  const part = parseMultipart(await readBody(req), req.headers['content-type']);
  if (!part || part.data.length === 0) return send(res, 400, { error: 'multipart field "file" is required' });
  const name = safeName(part.filename);
  await mkdir(DIR, { recursive: true });
  await writeFile(join(DIR, name), part.data);
  send(res, 201, { url: `${PUBLIC}/files/${name}` });
}

async function handlePresign(req, res) {
  if (!S3.accessKey || !S3.secretKey) return send(res, 501, { error: 'set S3_ACCESS_KEY and S3_SECRET_KEY' });
  const { name = 'file', type = 'application/octet-stream' } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
  const key = `uploads/${safeName(String(name))}`;
  const endpoint = new URL(S3.endpoint);
  const path = `/${S3.bucket}/${key}`; // path style, what MinIO expects by default
  const query = presignQuery({ method: 'PUT', host: endpoint.host, path, region: S3.region, accessKey: S3.accessKey, secretKey: S3.secretKey });
  send(res, 200, {
    url: `${endpoint.origin}${path}?${query}`,
    method: 'PUT',
    headers: { 'Content-Type': String(type) },
    // What ends up in the document: a public URL (or an `asset:` reference your resolveAsset understands).
    src: `${S3.publicBase ?? `${endpoint.origin}/${S3.bucket}`}/${key}`,
  });
}

async function handleFile(res, pathname) {
  const name = pathname.slice('/files/'.length);
  if (!/^[\w.-]+$/.test(name)) return send(res, 404, { error: 'not found' });
  try {
    const data = await readFile(join(DIR, name));
    send(res, 200, data, { 'Content-Type': TYPES[extname(name)] ?? 'application/octet-stream' });
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', PUBLIC);
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (req.method === 'POST' && pathname === '/upload') return await handleUpload(req, res);
    if (req.method === 'POST' && pathname === '/presign') return await handlePresign(req, res);
    if (req.method === 'GET' && pathname.startsWith('/files/')) return await handleFile(res, pathname);
    send(res, 404, { error: 'not found' });
  } catch (error) {
    send(res, error.status ?? 500, { error: String(error.message ?? error) });
  }
}).listen(PORT, () => console.log(`upload example on ${PUBLIC} (files in ${DIR})`));
