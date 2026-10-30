// Hand-written AWS Signature V4 query-string presign (S3 / MinIO / R2). Consumer-side example
// code: the credentials live on YOUR server, never in @rchemist/editor. Node built-ins only.
import { createHash, createHmac } from 'node:crypto';

const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');

// RFC 3986 encoding as AWS wants it ("/" kept in paths).
const encode = (value, keepSlash = false) =>
  encodeURIComponent(value)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%2F/g, keepSlash ? '/' : '%2F');

/**
 * @param {object} o
 * @param {string} o.method       'PUT' (or 'GET')
 * @param {string} o.host         host[:port] exactly as the client will send it
 * @param {string} o.path         '/bucket/key' (path style) or '/key' (virtual host style)
 * @param {string} o.region
 * @param {string} o.accessKey
 * @param {string} o.secretKey
 * @param {number} [o.expires]    seconds (default 600)
 * @param {Date}   [o.now]
 * @returns {string} the query string to append to the URL
 */
export function presignQuery({ method, host, path, region, accessKey, secretKey, expires = 600, now = new Date() }) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKey}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const query = Object.keys(params)
    .sort()
    .map((k) => `${encode(k)}=${encode(params[k])}`)
    .join('&');
  const canonical = [method, encode(path, true), query, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, day), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return `${query}&X-Amz-Signature=${signature}`;
}
