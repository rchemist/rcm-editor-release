import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JSONContent } from '@tiptap/core';
import type { DocparserAsset } from '../../src/docparser/types';

const ASSET_DIR = join(__dirname, '..', '..', 'fixtures', 'docparser', 'assets');
/** The 16x12 PNG used by synthetic-objects / synthetic-profile. */
export const PNG_SHA = 'e93186cbb1ded04219e0ed30fa82ae5a501e6256d4717c893c54a9a1ab25a1a7';
export const PNG_SRC = `asset:sha256:${PNG_SHA}`;

export function pngAsset(): DocparserAsset {
  const bytes = readFileSync(join(ASSET_DIR, `${PNG_SHA}.png`));
  return {
    sha256: PNG_SHA,
    media_type: 'image/png',
    width: 16,
    height: 12,
    bytes_b64: bytes.toString('base64'),
  };
}

export const para = (text: string): JSONContent => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});

export const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

export const imageBlock = (): JSONContent => ({
  type: 'image',
  attrs: { src: PNG_SRC, width: 160, height: 120 },
});

export function loadProfileFixture(slug: string) {
  return JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', 'fixtures', 'docparser', 'profile', `${slug}.json`),
      'utf8',
    ),
  ) as { doc: JSONContent; render_revision: string };
}
