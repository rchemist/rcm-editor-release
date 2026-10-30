import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor, JSONContent } from '@tiptap/core';
import { diffDocs, formatDifferences } from '../helpers/json-equal';
import { destroyEditors, makeEditor } from '../helpers/editor';

afterEach(destroyEditors);

const SRC = 'https://example.test/a.png';
const ASSET = `asset:sha256:${'b'.repeat(64)}`;
const RESOLVED = 'https://cdn.example.test/b.png';

const types = (json: JSONContent | undefined): string[] =>
  (json?.content ?? []).map((n) => n.type ?? '?');

const json = (editor: Editor) => editor.getJSON() as JSONContent;
const topTypes = (editor: Editor) => types(json(editor));

describe('inlineImage', () => {
  it('legacy <p>text<img>text</p> stays one paragraph and re-emits the same HTML', () => {
    const html = `<p>앞 글<img src="${SRC}" alt="그림" width="100" height="50">뒤 글</p>`;
    const editor = makeEditor(html);
    expect(topTypes(editor)).toEqual(['paragraph']);
    const p = json(editor).content![0]!;
    expect(types(p)).toEqual(['text', 'inlineImage', 'text']);
    expect(p.content![1]!.attrs).toMatchObject({ src: SRC, alt: '그림', width: 100, height: 50 });
    expect(editor.getHTML()).toBe(html);
  });

  it('<img> in heading text and in a table-cell paragraph is inline; a bare cell <img> stays a block image', () => {
    const editor = makeEditor(
      `<h2>제목<img src="${SRC}"></h2>` +
        `<table><tbody><tr><td><p>a<img src="${SRC}">b</p></td><td>c<img src="${SRC}"></td><td><img src="${SRC}"></td></tr></tbody></table>`,
    );
    const [heading, table] = json(editor).content!;
    expect(types(heading)).toEqual(['text', 'inlineImage']);
    const cells = table!.content![0]!.content!;
    expect(types(cells[0]!.content![0])).toEqual(['text', 'inlineImage', 'text']);
    expect(types(cells[1]!.content![0])).toEqual(['text', 'inlineImage']);
    expect(types(cells[2])).toEqual(['image']);
  });

  it('top-level and figure <img> stay block images (docparser JSON unchanged)', () => {
    const editor = makeEditor(
      `<p>a</p><img src="${SRC}" width="10"><figure><img src="${SRC}"><figcaption>c</figcaption></figure>`,
    );
    expect(topTypes(editor)).toEqual(['paragraph', 'image', 'figure']);
    expect(types(json(editor).content![2])).toEqual(['image', 'figcaption']);
  });

  it('inline images survive JSON → HTML → JSON with px-integer width/height', () => {
    const source: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'x' },
            {
              type: 'inlineImage',
              attrs: { src: ASSET, alt: 'a', title: 't', width: 32, height: 16 },
            },
            { type: 'text', text: 'y' },
          ],
        },
      ],
    };
    const back = makeEditor(makeEditor(source).getHTML()).getJSON();
    const diffs = diffDocs(source, back);
    expect(diffs, formatDifferences(diffs)).toEqual([]);
  });

  it('inline images use resolveAsset and the resize view (inline container)', () => {
    const resolveAsset = vi.fn(() => RESOLVED);
    const editor = makeEditor(`<p>a<img src="${ASSET}">b</p>`, { resolveAsset });
    expect(resolveAsset).toHaveBeenCalledWith(ASSET);
    const img = editor.view.dom.querySelector('p img')!;
    expect(img.getAttribute('src')).toBe(RESOLVED);
    const container = img.closest<HTMLElement>('[data-asset-state]')!;
    expect(container.getAttribute('data-asset-state')).toBe('resolved');
    expect(container.style.display).toBe('inline-flex');
    expect(editor.getHTML()).toContain(`src="${ASSET}"`);
  });

  it('disabling inlineImage restores the block behaviour', () => {
    const editor = makeEditor(`<p>a<img src="${SRC}">b</p>`, { features: { inlineImage: false } });
    expect(topTypes(editor)).toEqual(['paragraph', 'image', 'paragraph']);
  });

  it('setImage still inserts a block image', () => {
    const editor = makeEditor('<p>a</p>');
    editor.commands.setTextSelection(2);
    editor.commands.setImage({ src: SRC });
    expect(topTypes(editor)).toContain('image');
    expect(JSON.stringify(editor.getJSON())).not.toContain('inlineImage');
  });
});
