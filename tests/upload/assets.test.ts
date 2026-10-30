import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import { createDocparserAssetResolver } from '../../src/docparser/index';
import { refreshAssets } from '../../src/index';
import { destroyEditors, makeEditor } from '../helpers/editor';
import { PNG_SRC, pngAsset } from '../docparser/helpers';

afterEach(destroyEditors);

beforeEach(() => {
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:test/${++n}`) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
});

const ASSET = `asset:sha256:${'a'.repeat(64)}`;

const imgOf = (editor: Editor) => editor.view.dom.querySelector('img')!;
const stateOf = (editor: Editor) =>
  (imgOf(editor).closest('[data-asset-state]') ?? imgOf(editor)).getAttribute('data-asset-state');

describe('resolveAsset re-resolution', () => {
  it('a resolved URL that fails to load is resolved once more; the document src is unchanged', () => {
    let n = 0;
    const resolveAsset = vi.fn(() => `https://sig.test/${++n}`);
    const editor = makeEditor(`<img src="${ASSET}">`, { resolveAsset });
    expect(resolveAsset).toHaveBeenCalledTimes(1);
    expect(imgOf(editor).getAttribute('src')).toBe('https://sig.test/1');

    imgOf(editor).dispatchEvent(new Event('error'));
    expect(resolveAsset).toHaveBeenCalledTimes(2);
    expect(imgOf(editor).getAttribute('src')).toBe('https://sig.test/2');
    expect(editor.getHTML()).toContain(`src="${ASSET}"`);

    // once only: a second failure does not loop
    imgOf(editor).dispatchEvent(new Event('error'));
    expect(resolveAsset).toHaveBeenCalledTimes(2);
  });

  it('an async resolver is called again on failure and the new URL is shown', async () => {
    let n = 0;
    const resolveAsset = vi.fn(async () => `https://sig.test/${++n}`);
    const editor = makeEditor(`<img src="${ASSET}">`, { resolveAsset });
    await vi.waitFor(() => expect(imgOf(editor).getAttribute('src')).toBe('https://sig.test/1'));
    imgOf(editor).dispatchEvent(new Event('error'));
    await vi.waitFor(() => expect(imgOf(editor).getAttribute('src')).toBe('https://sig.test/2'));
    expect(resolveAsset).toHaveBeenCalledTimes(2);
  });

  it('plain URLs are not re-resolved on failure', () => {
    const resolveAsset = vi.fn(() => 'x');
    const editor = makeEditor('<img src="https://example.test/a.png">', { resolveAsset });
    imgOf(editor).dispatchEvent(new Event('error'));
    expect(resolveAsset).not.toHaveBeenCalled();
  });

  it('an image shown as missing is resolved again after resolveAsset.add()', () => {
    const resolver = createDocparserAssetResolver();
    const editor = makeEditor(`<img src="${PNG_SRC}">`, { resolveAsset: resolver });
    expect(stateOf(editor)).toBe('missing');
    resolver.add([pngAsset()]);
    expect(stateOf(editor)).toBe('resolved');
    expect(imgOf(editor).getAttribute('src')).toMatch(/^blob:test\//);
    expect(editor.getHTML()).toContain(`src="${PNG_SRC}"`);
  });

  it('refreshAssets() retries missing images for resolvers without add()', () => {
    let known = false;
    const resolveAsset = vi.fn(() => (known ? 'https://cdn.test/x.png' : undefined));
    const editor = makeEditor(`<img src="${ASSET}">`, { resolveAsset });
    expect(stateOf(editor)).toBe('missing');
    known = true;
    refreshAssets(resolveAsset);
    expect(stateOf(editor)).toBe('resolved');
    expect(imgOf(editor).getAttribute('src')).toBe('https://cdn.test/x.png');
  });

  it('a destroyed editor stops listening (no throw on a later add)', () => {
    const resolver = createDocparserAssetResolver();
    const editor = makeEditor(`<img src="${PNG_SRC}">`, { resolveAsset: resolver });
    editor.destroy();
    expect(() => resolver.add([pngAsset()])).not.toThrow();
  });
});
