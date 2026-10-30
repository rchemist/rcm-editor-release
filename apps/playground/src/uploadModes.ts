// e2e switches for the upload pipeline:
//   ?upload=manual  every upload waits for the test (window.__rcmUploads), progress/resolve/reject by hand
//   ?upload=http    httpUploader to /__upload (the test answers the request); ?resize=1 adds a canvas resize
//   (none)          the package default: base64Uploader()
import { httpUploader } from '@rchemist/editor/upload';
import type { RcmUploadError, RcmUploader } from '@rchemist/editor/upload';

export interface ManualUpload {
  name: string;
  aborted: boolean;
  progress: (fraction: number) => void;
  resolve: (src: string) => void;
  reject: (message: string) => void;
}

declare global {
  interface Window {
    /** Playground test hook (e2e): uploads waiting for the test, and reported errors. */
    __rcmUploads?: { calls: ManualUpload[]; errors: { code: string; name: string }[] };
  }
}

const query = new URLSearchParams(window.location.search);
const mode = query.get('upload');

function manualUploader(): RcmUploader {
  const hook = { calls: [] as ManualUpload[], errors: [] as { code: string; name: string }[] };
  window.__rcmUploads = hook;
  return (file, ctx) =>
    new Promise((resolve, reject) => {
      const call: ManualUpload = {
        name: file.name,
        aborted: false,
        progress: (fraction) => ctx.onProgress?.(fraction),
        resolve: (src) => resolve(src),
        reject: (message) => reject(new Error(message)),
      };
      ctx.signal.addEventListener('abort', () => (call.aborted = true));
      hook.calls.push(call);
    });
}

export const uploadImage: RcmUploader | undefined =
  mode === 'manual'
    ? manualUploader()
    : mode === 'http'
      ? httpUploader({
          endpoint: '/__upload',
          headers: { 'X-Playground': '1' },
          resize: query.get('resize') === '1' ? { maxWidth: 100, quality: 0.5 } : undefined,
        })
      : undefined;

// Non-image files go through the same mode uploader; in default mode a demo URL answers, so
// the toolbar `file` item (only rendered with a configured file uploader) is always present.
export const uploadFile: RcmUploader =
  uploadImage ?? (async (file) => `https://cdn.test/files/${encodeURIComponent(file.name)}`);

export function onUploadError(error: RcmUploadError, file: File): void {
  window.__rcmUploads?.errors.push({ code: error.code, name: file.name });
}
