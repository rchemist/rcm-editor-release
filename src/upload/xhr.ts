import { RcmUploadError } from './types';

export interface XhrRequest {
  url: string;
  method: string;
  body: XMLHttpRequestBodyInit;
  headers?: Record<string, string>;
  withCredentials?: boolean;
  signal: AbortSignal;
  onProgress?: (fraction: number) => void;
}

/**
 * One XHR request with upload progress and abort. Resolves with the finished `XMLHttpRequest`
 * for 2xx; rejects with `RcmUploadError` (`http` with `status`, `network`, `abort`).
 */
export function xhrSend(request: XhrRequest): Promise<XMLHttpRequest> {
  return new Promise((resolve, reject) => {
    if (request.signal.aborted) {
      reject(new RcmUploadError('abort', 'Upload aborted'));
      return;
    }
    if (typeof XMLHttpRequest === 'undefined') {
      reject(new RcmUploadError('other', 'XMLHttpRequest is not available'));
      return;
    }
    const xhr = new XMLHttpRequest();
    let last = 0;
    const progress = (fraction: number) => {
      const value = Math.min(1, Math.max(last, fraction));
      if (value === last) return;
      last = value;
      request.onProgress?.(value);
    };
    const onAbort = () => xhr.abort();
    const done = () => request.signal.removeEventListener('abort', onAbort);

    xhr.open(request.method, request.url, true);
    for (const [name, value] of Object.entries(request.headers ?? {}))
      xhr.setRequestHeader(name, value);
    if (request.withCredentials) xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) progress(event.loaded / event.total);
    };
    xhr.onload = () => {
      done();
      if (xhr.status >= 200 && xhr.status < 300) {
        progress(1);
        resolve(xhr);
      } else {
        reject(
          new RcmUploadError('http', `Upload failed with HTTP ${xhr.status}`, {
            status: xhr.status,
          }),
        );
      }
    };
    xhr.onerror = () => {
      done();
      reject(new RcmUploadError('network', 'Network error'));
    };
    xhr.ontimeout = xhr.onerror;
    xhr.onabort = () => {
      done();
      reject(new RcmUploadError('abort', 'Upload aborted'));
    };
    request.signal.addEventListener('abort', onAbort, { once: true });
    xhr.send(request.body);
  });
}
