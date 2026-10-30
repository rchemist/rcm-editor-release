// Playground only: serves docparser fixture assets (fixtures/docparser/assets/<sha256>.<ext>)
// and fixtures/docparser-large/assets/ to the editor's resolveAsset for `asset:sha256:<hex>` image srcs.
import { createDocparserAssetResolver } from '@rchemist/editor/docparser';

const assetUrls = import.meta.glob('../../../fixtures/*/assets/*', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const bySha = new Map<string, string>();
for (const [path, url] of Object.entries(assetUrls)) {
  const file = path.slice(path.lastIndexOf('/') + 1);
  bySha.set(file.replace(/\.[^.]+$/, ''), url);
}

export function resolveFixtureAsset(src: string): string | null {
  const m = /^asset:sha256:([0-9a-f]{64})$/.exec(src);
  return m ? (bySha.get(m[1]!) ?? null) : null;
}

/**
 * The playground editor's `resolveAsset`: images of opened/inserted docparser responses
 * (blob URLs from `assets[]`), then the bundled fixture assets. It has `add`, so
 * `insertDocument(…, { assets })` registers new assets here.
 */
const responseAssets = createDocparserAssetResolver();
export const playgroundAssets = Object.assign(
  (src: string): string | undefined => responseAssets(src) ?? resolveFixtureAsset(src) ?? undefined,
  { add: responseAssets.add, dispose: responseAssets.dispose },
);
