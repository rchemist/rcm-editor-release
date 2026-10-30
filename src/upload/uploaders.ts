import { preparePolicyFile, throwIfAborted } from './policy';
import { RcmUploadError } from './types';
import type { RcmUploadContext, RcmUploadResult, RcmUploader, UploadPolicy } from './types';
import { xhrSend } from './xhr';

const MIB = 1024 * 1024;

/** Default size limit of `base64Uploader` (the data URL ends up inside the document). */
export const DEFAULT_BASE64_MAX_BYTES = 2 * MIB;

function readDataUrl(file: Blob, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const onAbort = () => reader.abort();
    reader.onload = () => {
      signal.removeEventListener('abort', onAbort);
      resolve(String(reader.result));
    };
    reader.onerror = () => {
      signal.removeEventListener('abort', onAbort);
      reject(new RcmUploadError('other', 'File could not be read'));
    };
    reader.onabort = () => reject(new RcmUploadError('abort', 'Upload aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    reader.readAsDataURL(file);
  });
}

/**
 * Embeds the file as a `data:` URL (no server needed). Defaults: `accept: ['image/*']`,
 * `maxBytes: 2 MiB` (checked after `resize`).
 */
export function base64Uploader(policy: UploadPolicy = {}): RcmUploader {
  const effective: UploadPolicy = {
    ...policy,
    accept: policy.accept ?? ['image/*'],
    // `{ maxBytes: undefined }` must not drop the 2 MiB default.
    maxBytes: policy.maxBytes ?? DEFAULT_BASE64_MAX_BYTES,
  };
  return async (file, { signal, onProgress }) => {
    throwIfAborted(signal);
    const prepared = await preparePolicyFile(file, effective);
    const src = await readDataUrl(prepared, signal);
    onProgress?.(1);
    return { src };
  };
}

export interface HttpUploaderOptions extends UploadPolicy {
  endpoint: string;
  /** Default `POST`. */
  method?: string;
  /** Multipart field of the file (default `file`). */
  fieldName?: string;
  /** Extra form fields, sent before the file. */
  fields?: Record<string, string>;
  headers?: Record<string, string>;
  /** Headers computed per upload (merged over `headers`). */
  getHeaders?: (file: File) => Record<string, string> | Promise<Record<string, string>>;
  withCredentials?: boolean;
  /**
   * Maps the response to a `src` (URL or `asset:` reference) or `{ src, name? }`. `body` is the
   * parsed JSON when the response is JSON, else the response text. Default: JSON `url` or `src`.
   */
  mapResponse?: (
    body: unknown,
    xhr: XMLHttpRequest,
  ) => string | RcmUploadResult | Promise<string | RcmUploadResult>;
}

function parseBody(xhr: XMLHttpRequest): unknown {
  const text = xhr.responseText;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function defaultMapResponse(body: unknown): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    for (const key of ['url', 'src']) {
      const value = record[key];
      if (typeof value === 'string' && value !== '') return value;
    }
  }
  throw new RcmUploadError('other', 'The response has no "url" or "src"');
}

function normalizeResult(value: unknown): RcmUploadResult {
  if (typeof value === 'string' && value !== '') return { src: value };
  if (value && typeof value === 'object') {
    const record = value as { src?: unknown; name?: unknown };
    if (typeof record.src === 'string' && record.src !== '')
      return typeof record.name === 'string'
        ? { src: record.src, name: record.name }
        : { src: record.src };
  }
  throw new RcmUploadError('other', 'The uploader returned no src');
}

export { normalizeResult as normalizeUploadResult };

/** Multipart upload to your backend (XHR: progress and abort). */
export function httpUploader(options: HttpUploaderOptions): RcmUploader {
  const {
    endpoint,
    method = 'POST',
    fieldName = 'file',
    fields,
    headers,
    getHeaders,
    withCredentials,
    mapResponse = defaultMapResponse,
    ...policy
  } = options;
  return async (file: File, { signal, onProgress }: RcmUploadContext) => {
    throwIfAborted(signal);
    const prepared = await preparePolicyFile(file, policy);
    const form = new FormData();
    for (const [name, value] of Object.entries(fields ?? {})) form.append(name, value);
    form.append(fieldName, prepared, prepared.name);
    const merged = { ...headers, ...(getHeaders ? await getHeaders(prepared) : {}) };
    throwIfAborted(signal);
    const xhr = await xhrSend({
      url: endpoint,
      method,
      body: form,
      headers: merged,
      withCredentials,
      signal,
      onProgress,
    });
    try {
      return normalizeResult(await mapResponse(parseBody(xhr), xhr));
    } catch (error) {
      if (error instanceof RcmUploadError) throw error;
      throw new RcmUploadError('other', 'mapResponse failed', { cause: error });
    }
  };
}

/** What your `presign` callback returns. */
export interface PresignedTarget {
  url: string;
  method: 'PUT' | 'POST';
  /** PUT: request headers (e.g. `Content-Type`). POST: ignored unless you need extra ones. */
  headers?: Record<string, string>;
  /** POST: form fields (S3 POST policy) sent before the file. */
  fields?: Record<string, string>;
  /** What is written to the document on success: the public URL or an `asset:` reference. */
  src: string;
}

export interface PresignedUploaderOptions extends UploadPolicy {
  /**
   * Your server signs the upload (S3, R2, GCS, MinIO…). The package never holds credentials or
   * a cloud SDK: it only sends the file to the URL you return.
   */
  presign: (file: File) => Promise<PresignedTarget> | PresignedTarget;
}

/** PUT (body = the file) or POST (form: `fields` first, `file` last) to a presigned URL. */
export function presignedUploader(options: PresignedUploaderOptions): RcmUploader {
  const { presign, ...policy } = options;
  return async (file: File, { signal, onProgress }: RcmUploadContext) => {
    throwIfAborted(signal);
    const prepared = await preparePolicyFile(file, policy);
    const target = await presign(prepared);
    throwIfAborted(signal);
    if (!target || typeof target.url !== 'string' || typeof target.src !== 'string')
      throw new RcmUploadError('other', 'presign must return { url, method, src }');
    let body: XMLHttpRequestBodyInit;
    if (target.method === 'POST') {
      const form = new FormData();
      for (const [name, value] of Object.entries(target.fields ?? {})) form.append(name, value);
      form.append('file', prepared, prepared.name);
      body = form;
    } else {
      body = prepared;
    }
    await xhrSend({
      url: target.url,
      method: target.method,
      body,
      headers: target.headers,
      signal,
      onProgress,
    });
    return { src: target.src };
  };
}
