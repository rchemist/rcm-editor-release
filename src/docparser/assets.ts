import { DocparserImportError } from './errors';
import type { DocparserAsset, DocparserAssetResolver } from './types';

const ASSET_SRC = /^asset:sha256:([0-9a-fA-F]+)$/;

export function parseAssetSha(src: string): string | null {
  const match = ASSET_SRC.exec(src);
  return match ? match[1]!.toLowerCase() : null;
}

/** Throws `invalid_asset` unless `value` has the docparser asset shape. */
export function validateAsset(value: unknown, index: number): DocparserAsset {
  const where = `assets[${index}]`;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new DocparserImportError('invalid_asset', `${where} is not an object`);
  const asset = value as Record<string, unknown>;
  for (const key of ['sha256', 'media_type', 'bytes_b64'] as const)
    if (typeof asset[key] !== 'string' || asset[key] === '')
      throw new DocparserImportError('invalid_asset', `${where}.${key} must be a non-empty string`);
  if (!/^[0-9a-fA-F]+$/.test(asset.sha256 as string))
    throw new DocparserImportError('invalid_asset', `${where}.sha256 must be hexadecimal`);
  return asset as unknown as DocparserAsset;
}

function decodeBase64(b64: string): Uint8Array | null {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

interface Entry {
  asset: DocparserAsset;
  url?: string;
}

/**
 * Builds a resolver for `asset:sha256:<hex>` srcs from docparser `assets[]`. A blob URL is
 * created on the first resolve of an asset and cached; `dispose()` revokes them all. Unknown
 * hashes (and undecodable bytes) resolve to `undefined`: the image node view shows its
 * missing state. `assets` is validated up front (`DocparserImportError` `invalid_asset`).
 */
export function createDocparserAssetResolver(
  assets?: readonly DocparserAsset[] | null,
): DocparserAssetResolver {
  const entries = new Map<string, Entry>();

  const resolver = ((src: string): string | undefined => {
    if (typeof src !== 'string') return undefined;
    const sha = parseAssetSha(src);
    const entry = sha ? entries.get(sha) : undefined;
    if (!entry) return undefined;
    if (entry.url) return entry.url;
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return undefined;
    const bytes = decodeBase64(entry.asset.bytes_b64);
    if (!bytes) return undefined;
    entry.url = URL.createObjectURL(
      new Blob([bytes as BlobPart], { type: entry.asset.media_type }),
    );
    return entry.url;
  }) as DocparserAssetResolver;

  resolver.add = (list) => {
    if (list === null || list === undefined) return;
    if (!Array.isArray(list))
      throw new DocparserImportError('invalid_asset', 'assets must be an array');
    // Validate everything first so a bad entry does not leave a half-registered batch.
    const valid = list.map((a, i) => validateAsset(a, i));
    for (const asset of valid) {
      const sha = asset.sha256.toLowerCase();
      if (!entries.has(sha)) entries.set(sha, { asset });
    }
  };

  resolver.dispose = () => {
    for (const entry of entries.values()) {
      if (entry.url && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function')
        URL.revokeObjectURL(entry.url);
    }
    entries.clear();
  };

  resolver.add(assets);
  return resolver;
}
