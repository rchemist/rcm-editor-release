import { afterEach, describe, expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { destroyEditors, makeEditor } from '../helpers/editor';

afterEach(destroyEditors);

const DATA = 'data:image/png;base64,iVBORw0KGgo=';

describe('data URL images are preserved (top complaint: silent HTML loss)', () => {
  it('a block <img src="data:…"> parses as image and re-emits byte-identically', () => {
    const html = `<img src="${DATA}">`;
    const editor = makeEditor(html);
    const node = (editor.getJSON() as JSONContent).content![0]!;
    expect(node.type).toBe('image');
    expect(node.attrs?.src).toBe(DATA);
    expect(editor.getHTML()).toBe(html);
  });

  it('an <img src="data:…"> inside text parses as inlineImage and re-emits byte-identically', () => {
    const html = `<p>앞<img src="${DATA}" alt="x" width="10" height="5">뒤</p>`;
    const editor = makeEditor(html);
    const p = (editor.getJSON() as JSONContent).content![0]!;
    expect(p.content!.map((n) => n.type)).toEqual(['text', 'inlineImage', 'text']);
    expect(p.content![1]!.attrs?.src).toBe(DATA);
    expect(editor.getHTML()).toBe(html);
  });

  it('JSON content with a data URL src loads unchanged', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [{ type: 'image', attrs: { src: DATA } }],
    });
    expect((editor.getJSON() as JSONContent).content![0]!.attrs?.src).toBe(DATA);
  });
});
