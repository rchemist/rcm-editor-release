import type { JSONContent } from '@tiptap/core';

/** One image of a docparser render response (`assets[]`, docs/tiptap.md §5). */
export interface DocparserAsset {
  /** Lowercase hex SHA-256 of the bytes; the document refers to it as `asset:sha256:<hex>`. */
  sha256: string;
  media_type: string;
  width?: number;
  height?: number;
  /** Standard base64 of the image bytes. */
  bytes_b64: string;
}

/** A render warning (`{code, ordinal, block_id}`); unknown extra keys are kept. */
export interface DocparserWarning {
  code: string;
  ordinal?: number | null;
  block_id?: string | null;
  [key: string]: unknown;
}

/** `docs[i]` of a ranged render: the HTTP wrapper `{range, doc}` or a bare `doc`. */
export type DocparserRangeDoc = JSONContent | { doc: JSONContent; range?: unknown; title?: string };

/**
 * A docparser render response (HTTP body of `documents:render`) or the equivalent library
 * result: `doc` for a whole render, `docs` for a ranged render.
 */
export interface DocparserResponse {
  doc?: JSONContent;
  docs?: DocparserRangeDoc[];
  assets?: DocparserAsset[] | null;
  warnings?: DocparserWarning[] | null;
  render_revision?: string;
}

/**
 * Display resolver for `asset:sha256:<hex>` image srcs: a function (usable as the editor's
 * `resolveAsset`) that also takes more assets and releases its blob URLs.
 */
export interface DocparserAssetResolver {
  (src: string): string | undefined;
  /** Register assets (content-addressed: a known sha256 keeps its first copy). */
  add(assets: readonly DocparserAsset[] | null | undefined): void;
  /** Revoke every blob URL and forget the assets. The resolver stays usable (`add` again). */
  dispose(): void;
}
