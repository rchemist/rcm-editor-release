// Upload contract: framework-free types shared by the editor pipeline and the uploaders.

/** Passed to every uploader call. */
export interface RcmUploadContext {
  /** Aborted when the placeholder is dismissed or the editor is destroyed. */
  signal: AbortSignal;
  /** Fraction 0–1 (the pipeline keeps the displayed value monotonic). */
  onProgress?: (fraction: number) => void;
}

/** What an uploader resolves to: a URL or an `asset:` reference written to the document. */
export interface RcmUploadResult {
  src: string;
  /** Link text for non-image files (default: the file name). */
  name?: string;
}

/** An uploader may resolve to a bare `src` string or a full result. */
export type RcmUploader = (
  file: File,
  context: RcmUploadContext,
) => Promise<string | RcmUploadResult>;

export type RcmUploadErrorCode = 'type' | 'size' | 'http' | 'network' | 'abort' | 'other';

/** Every upload failure the pipeline reports is an `RcmUploadError`. */
export class RcmUploadError extends Error {
  readonly code: RcmUploadErrorCode;
  /** HTTP status (`code: 'http'`). */
  readonly status?: number;

  constructor(
    code: RcmUploadErrorCode,
    message?: string,
    options?: { status?: number; cause?: unknown },
  ) {
    super(message ?? code);
    this.name = 'RcmUploadError';
    this.code = code;
    if (options?.status !== undefined) this.status = options.status;
    if (options?.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

/** Client side image downscale / recompression (canvas). */
export interface UploadResize {
  /** Longest allowed width in px (the image is never enlarged). */
  maxWidth?: number;
  maxHeight?: number;
  /** 0–1 for lossy output types (default 0.85). */
  quality?: number;
  /** Output type (default: the original type when JPEG/WebP, else PNG). */
  mimeType?: string;
}

/** Validation / preparation shared by every built-in uploader. */
export interface UploadPolicy {
  /** MIME types (`image/png`, `image/*`) or extensions (`.pdf`). Outside → `code: 'type'`, no request. */
  accept?: readonly string[];
  /** Largest allowed size in bytes, checked after `resize`. Over → `code: 'size'`, no request. */
  maxBytes?: number;
  /** Images only. Without it the original bytes are sent untouched. GIF and SVG are never resized. */
  resize?: UploadResize;
}

export type UploadErrorHandler = (error: RcmUploadError, file: File) => void;
