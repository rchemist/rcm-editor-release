import { RcmUploadError } from './types';
import type { RcmUploadContext, RcmUploader, UploadPolicy, UploadResize } from './types';

/** `image/*`, `image/png` or `.png` against a file. */
export function matchesAccept(file: File, accept: readonly string[]): boolean {
  const type = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  return accept.some((raw) => {
    const rule = raw.trim().toLowerCase();
    if (!rule) return false;
    if (rule === '*/*' || rule === '*') return true;
    if (rule.startsWith('.')) return name.endsWith(rule);
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

const NO_RESIZE = new Set(['image/gif', 'image/svg+xml']);

function extensionFor(mime: string): string | null {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return null;
  }
}

function renamed(name: string, mime: string): string {
  const ext = extensionFor(mime);
  if (!ext) return name;
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.${ext}`;
}

async function decode(file: File): Promise<{
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  close: () => void;
} | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
        close: () => bitmap.close(),
      };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Downscales / recompresses an image through a canvas. Returns the original file when nothing
 * would improve (GIF/SVG, not decodable, no canvas, or the result is not smaller and nothing was
 * downscaled), so original bytes are never replaced by a worse copy.
 */
export async function resizeImage(file: File, options: UploadResize): Promise<File> {
  const type = (file.type || '').toLowerCase();
  if (!type.startsWith('image/') || NO_RESIZE.has(type)) return file;
  if (typeof document === 'undefined') return file;
  const source = await decode(file);
  if (!source) return file;
  try {
    const { maxWidth, maxHeight } = options;
    let scale = 1;
    if (maxWidth && maxWidth > 0 && source.width > maxWidth)
      scale = Math.min(scale, maxWidth / source.width);
    if (maxHeight && maxHeight > 0 && source.height > maxHeight)
      scale = Math.min(scale, maxHeight / source.height);
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const mime =
      options.mimeType ?? (type === 'image/jpeg' || type === 'image/webp' ? type : 'image/png');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    source.draw(ctx, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mime, options.quality ?? 0.85),
    );
    if (!blob) return file;
    if (scale === 1 && blob.size >= file.size) return file;
    return new File([blob], renamed(file.name, blob.type || mime), {
      type: blob.type || mime,
      lastModified: file.lastModified,
    });
  } finally {
    source.close();
  }
}

/**
 * With `resize`, decoding (`createImageBitmap`) reads the whole original into memory before any
 * size check runs, so the original is capped first: 10× `maxBytes` when a limit is set (resize
 * exists to bring big images under it), else 50 MiB. An internal bound, not a policy
 * option — consumers wanting a higher ceiling set a proportional `maxBytes`.
 */
const RESIZE_INPUT_FACTOR = 10;
const DEFAULT_RESIZE_INPUT_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Validates `file` against `policy` and returns the file to send (resized when configured).
 * Throws `RcmUploadError` `type` / `size` before anything is sent.
 */
export async function preparePolicyFile(file: File, policy: UploadPolicy): Promise<File> {
  if (policy.accept && !matchesAccept(file, policy.accept))
    throw new RcmUploadError('type', `File type "${file.type || file.name}" is not accepted`);
  let out = file;
  if (policy.resize) {
    const inputCap =
      policy.maxBytes !== undefined
        ? policy.maxBytes * RESIZE_INPUT_FACTOR
        : DEFAULT_RESIZE_INPUT_MAX_BYTES;
    // Before any decode: a huge "image" must not be fully decoded just to be rejected.
    if (file.size > inputCap)
      throw new RcmUploadError(
        'size',
        `File is ${file.size} bytes, the resize input limit is ${inputCap}`,
      );
    try {
      out = await resizeImage(file, policy.resize);
    } catch {
      out = file;
    }
  }
  if (policy.maxBytes !== undefined && out.size > policy.maxBytes)
    throw new RcmUploadError('size', `File is ${out.size} bytes, the limit is ${policy.maxBytes}`);
  return out;
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new RcmUploadError('abort', 'Upload aborted');
}

/** Wraps a user function with the same validation and resizing as the built-in uploaders. */
export function withPolicy(fn: RcmUploader, policy: UploadPolicy = {}): RcmUploader {
  return async (file: File, context: RcmUploadContext) => {
    throwIfAborted(context.signal);
    const prepared = await preparePolicyFile(file, policy);
    throwIfAborted(context.signal);
    return fn(prepared, context);
  };
}
