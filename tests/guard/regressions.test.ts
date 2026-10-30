// Content guard regressions: edge-case scenarios for the lossless guard.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { Editor } from '@tiptap/core';
import { createEditorExtensions, getContentReport, getLosslessJSON } from '../../src/index';
import { createDocparserAssetResolver } from '../../src/docparser/index';
import { resetDevWarnings } from '../../src/react/devWarnings';
import { diffDocs, formatDifferences, stableStringify } from '../helpers/json-equal';
import { destroyEditors, makeEditor } from '../helpers/editor';

afterEach(() => {
  destroyEditors();
  vi.restoreAllMocks();
});

const text = (t: string, marks?: JSONContent['marks']): JSONContent =>
  marks ? { type: 'text', text: t, marks } : { type: 'text', text: t };
const p = (t: string): JSONContent => ({ type: 'paragraph', content: [text(t)] });
const types = (json: JSONContent) => (json.content ?? []).map((n) => n.type);
const kinds = (editor: Editor) => getContentReport(editor)?.unsupported.map((u) => u.kind) ?? [];
const expectLossless = (actual: unknown, expected: unknown) => {
  const diffs = diffDocs(expected, actual);
  expect(diffs, formatDifferences(diffs)).toEqual([]);
};

describe('misplaced but valid children', () => {
  it('legacy block image inside a paragraph becomes an inlineImage; the paragraph stays editable text', () => {
    const image = { type: 'image', attrs: { src: 'a.png' } };
    const legacy = { type: 'paragraph', content: [text('see '), image, text(' here')] };
    const doc = { type: 'doc', content: [p('first'), legacy] };
    const editor = makeEditor(doc);
    const json = editor.getJSON();
    expect(types(json)).toEqual(['paragraph', 'paragraph']);
    expect(json.content![1]!.content!.map((n) => n.type)).toEqual(['text', 'inlineImage', 'text']);
    expect(editor.getText()).toContain('see ');
    expect(editor.getText()).toContain(' here');
    const lossless = getLosslessJSON(editor);
    expect(lossless.content![1]!.content![1]).toEqual(image);
    expectLossless(lossless, doc);
    expect(kinds(editor)).toEqual(['remapped']);
  });

  it('a listItem outside a list is wrapped in a bulletList, not the whole document', () => {
    const item = { type: 'listItem', content: [p('li')] };
    const doc = { type: 'doc', content: [p('a'), p('b'), item, p('c')] };
    const editor = makeEditor(doc);
    expect(types(editor.getJSON())).toEqual(['paragraph', 'paragraph', 'bulletList', 'paragraph']);
    for (const t of ['a', 'b', 'li', 'c']) expect(editor.getText()).toContain(t);
    const lossless = getLosslessJSON(editor);
    expect(lossless.content![2]).toEqual(item);
    expectLossless(lossless, doc);
    expect(kinds(editor)).toEqual(['remapped']);
  });

  it('top-level text is wrapped in a paragraph (editable), restored as top-level text', () => {
    const doc = { type: 'doc', content: [p('a'), text('loose'), text('bold', [{ type: 'bold' }])] };
    const editor = makeEditor(doc);
    expect(types(editor.getJSON())).toEqual(['paragraph', 'paragraph']);
    expect(editor.isEditable).toBe(true);
    expect(editor.getText()).toContain('loosebold');
    const lossless = getLosslessJSON(editor);
    expect(lossless.content!.slice(1)).toEqual(doc.content.slice(1));
    expect(kinds(editor)).toEqual(['remapped']);
  });

  it('a paragraph nested in a paragraph is held inline; the outer text stays editable', () => {
    const nested = p('nested');
    const doc = {
      type: 'doc',
      content: [p('x'), { type: 'paragraph', content: [text('pre'), nested] }],
    };
    const editor = makeEditor(doc);
    const json = editor.getJSON();
    expect(types(json)).toEqual(['paragraph', 'paragraph']);
    expect(json.content![1]!.content!.map((n) => n.type)).toEqual(['text', 'unsupportedInline']);
    expect(getLosslessJSON(editor).content![1]!.content![1]).toEqual(nested);
    expectLossless(getLosslessJSON(editor), doc);
    expect(kinds(editor)).toEqual(['misplaced']);
  });

  it('a remapped node edited by the user keeps the edit and its original type', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [text('a'), { type: 'image', attrs: { src: 'a.png' } }] },
      ],
    };
    const editor = makeEditor(doc);
    let pos = -1;
    editor.state.doc.descendants((n, at) => {
      if (n.type.name === 'inlineImage') pos = at;
    });
    editor.commands.command(({ tr }) => {
      tr.setNodeAttribute(pos, 'alt', 'edited');
      return true;
    });
    expect(getLosslessJSON(editor).content![0]!.content![1]).toMatchObject({
      type: 'image',
      attrs: { src: 'a.png', alt: 'edited' },
    });
  });
  it('remapped content survives JSON → HTML → JSON', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [text('see '), { type: 'image', attrs: { src: 'a.png' } }] },
        { type: 'listItem', content: [p('li')] },
        text('loose'),
      ],
    };
    const html = makeEditor(doc).getHTML();
    const back = makeEditor(html);
    expect(types(back.getJSON())).toEqual(['paragraph', 'bulletList', 'paragraph']);
    expectLossless(getLosslessJSON(back), doc);
  });
});

describe('holder JSON re-hydrates on reload', () => {
  it('getJSON() → reload → getLosslessJSON restores unsupportedNode/Inline/Attrs/Mark originals', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { foo: 1 },
          content: [
            text('x', [{ type: 'zzz' }, { type: 'textStyle', attrs: { color: '#ff0000', w: 7 } }]),
            { type: 'mention', attrs: { id: 'u1' } },
          ],
        },
        { type: 'mystery', attrs: { a: 1 } },
      ],
    };
    const first = makeEditor(doc);
    const expected = getLosslessJSON(first);
    const saved = first.getJSON();
    const second = makeEditor(saved);
    const back = getLosslessJSON(second);
    expect(stableStringify(back)).toBe(stableStringify(expected));
    expect(JSON.stringify(back)).not.toMatch(/unsupported/);
    // a second save/reload cycle is stable too
    const third = makeEditor(second.getJSON());
    expect(stableStringify(getLosslessJSON(third))).toBe(stableStringify(expected));
    expect(new Set(getContentReport(second)!.unsupported.map((u) => u.kind))).toEqual(
      new Set(['attrs', 'mark', 'inline', 'node']),
    );
  });

  it('a remapped node survives getJSON() → reload with its original restored', () => {
    const image = { type: 'image', attrs: { src: 'a.png' } };
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [text('a'), image] }] };
    const second = makeEditor(makeEditor(doc).getJSON());
    expect(getLosslessJSON(second).content![0]!.content![1]).toEqual(image);
  });
});

describe('link default attributes', () => {
  it('a link gets no default target/rel: JSON and HTML unchanged', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [text('l', [{ type: 'link', attrs: { href: '/x', class: 'btn' } }])],
        },
      ],
    };
    const editor = makeEditor(doc);
    expectLossless(getLosslessJSON(editor), doc);
    const a = new DOMParser().parseFromString(editor.getHTML(), 'text/html').querySelector('a')!;
    expect(a.getAttribute('href')).toBe('/x');
    expect(a.getAttribute('class')).toBe('btn');
    expect(a.hasAttribute('target')).toBe(false);
    expect(a.hasAttribute('rel')).toBe(false);

    const fromHtml = makeEditor('<p><a href="/x" class="btn">l</a></p>');
    expect(fromHtml.getHTML()).toBe('<p><a class="btn" href="/x">l</a></p>');
  });

  it('target/rel given in the input are kept', () => {
    const html = '<p><a target="_self" rel="author" href="/y">l</a></p>';
    expect(makeEditor(html).getHTML()).toBe(html);
  });
});

describe('fatal state', () => {
  const cyclic = () => {
    const doc: { type: string; content: unknown[] } = { type: 'doc', content: [] };
    doc.content.push({ type: 'paragraph', attrs: { self: doc } });
    return doc;
  };

  it('a successful setContent after a fatal load makes the editor editable again', () => {
    const editor = makeEditor(p('ok'));
    editor.commands.setContent(cyclic() as JSONContent);
    expect(editor.isEditable).toBe(false);
    expect(getContentReport(editor)?.fatal).toBeTruthy();
    const good = { type: 'doc', content: [p('good')] };
    editor.commands.setContent(good);
    expect(editor.isEditable).toBe(true);
    expectLossless(getLosslessJSON(editor), good);
  });

  it('while fatal, edits are refused so getLosslessJSON never goes stale', () => {
    const editor = makeEditor(p('ok'));
    const original = cyclic();
    editor.commands.setContent(original as JSONContent);
    const before = editor.getJSON();
    editor.commands.insertContent('<p>added</p>');
    editor.commands.insertContentAt(0, { type: 'paragraph', content: [text('more')] });
    editor.commands.insertDocument({ type: 'doc', content: [p('doc')] });
    expect(editor.getJSON()).toEqual(before);
    expect(editor.getText()).not.toMatch(/added|more|doc/);
    expect(getLosslessJSON(editor)).toBe(original);
  });

  it('an editor created read-only stays read-only after recovering from fatal', () => {
    const editor = new Editor({
      extensions: createEditorExtensions(),
      content: p('ok'),
      editable: false,
    });
    try {
      editor.commands.setContent(cyclic() as JSONContent);
      editor.commands.setContent(p('good'));
      expect(editor.isEditable).toBe(false);
      expect(getContentReport(editor)?.fatal).toBeUndefined();
    } finally {
      editor.destroy();
    }
  });
});

describe('unknown node keys', () => {
  it('unknown top-level keys on nodes and text are kept, restored and reported', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          id: 'blk-1',
          meta: { x: 1 },
          content: [{ type: 'text', text: 't', extra: 1 }],
        },
      ],
    };
    const editor = makeEditor(doc);
    const out = getLosslessJSON(editor) as JSONContent & { content: Record<string, unknown>[] };
    expect(out.content[0]!.id).toBe('blk-1');
    expect(out.content[0]!.meta).toEqual({ x: 1 });
    expect((out.content[0]!.content as Record<string, unknown>[])[0]).toEqual({
      type: 'text',
      text: 't',
      extra: 1,
    });
    expectLossless(out, doc);
    expect(kinds(editor)).toEqual(['keys', 'keys']);
    // and through a getJSON() reload
    expectLossless(getLosslessJSON(makeEditor(editor.getJSON())), doc);
  });
});

describe('contentGuard off', () => {
  it('features.contentGuard: false warns once in development', () => {
    resetDevWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createEditorExtensions({ features: { contentGuard: false } });
    createEditorExtensions({ features: { contentGuard: false } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/contentGuard/);
  });
});

describe('CSS injection through style attributes', () => {
  const EVIL = 'red; background-image: url(https://evil.example/t.png)';
  const cellDoc = (attrs: Record<string, unknown>) => ({
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs, content: [p('c')] }] }],
      },
    ],
  });
  const paraDoc = (attrs: Record<string, unknown>) => ({
    type: 'doc',
    content: [{ type: 'paragraph', attrs, content: [text('x')] }],
  });
  const markDoc = (type: string, attrs: Record<string, unknown>) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [text('x', [{ type, attrs }])] }],
  });

  const cases: [string, JSONContent][] = [
    ['tableCell backgroundColor', cellDoc({ backgroundColor: EVIL })],
    ['tableCell borderTop', cellDoc({ borderTop: `1px solid ${EVIL}` })],
    ['tableCell verticalAlign', cellDoc({ verticalAlign: EVIL })],
    [
      'table border',
      {
        type: 'doc',
        content: [
          {
            type: 'table',
            attrs: { border: `1px solid ${EVIL}` },
            content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('c')] }] }],
          },
        ],
      },
    ],
    ['paragraph indent', paraDoc({ indent: EVIL })],
    ['paragraph marginLeft', paraDoc({ marginLeft: EVIL })],
    ['paragraph lineHeight', paraDoc({ lineHeight: EVIL })],
    ['paragraph spaceBefore', paraDoc({ spaceBefore: EVIL })],
    ['paragraph textAlign', paraDoc({ textAlign: EVIL })],
    ['textStyle color', markDoc('textStyle', { color: EVIL })],
    ['textStyle backgroundColor', markDoc('textStyle', { backgroundColor: EVIL })],
    ['textStyle fontFamily', markDoc('textStyle', { fontFamily: EVIL })],
    ['textStyle fontSize', markDoc('textStyle', { fontSize: EVIL })],
    ['textStyle letterSpacing', markDoc('textStyle', { letterSpacing: EVIL })],
    ['textStyle fontStretch', markDoc('textStyle', { fontStretch: EVIL })],
    ['highlight color', markDoc('highlight', { color: EVIL })],
    [
      'textBox backgroundColor',
      {
        type: 'doc',
        content: [{ type: 'textBox', attrs: { backgroundColor: EVIL }, content: [p('t')] }],
      },
    ],
  ];

  for (const [name, doc] of cases)
    it(`${name}: an injected declaration never reaches the HTML or the view`, () => {
      const editor = makeEditor(doc);
      expect(getContentReport(editor)?.unsupported ?? []).toEqual([]);
      expect(editor.getHTML()).not.toMatch(/evil|url\(/);
      expect(editor.view.dom.innerHTML).not.toMatch(/evil|url\(/);
    });

  it('other dangerous values are refused too (expression, javascript:, @import, escapes)', () => {
    for (const color of [
      'expression(alert(1))',
      'javascript:alert(1)',
      '@import "x"',
      '\\75 rl(x)',
      'red\nbackground: blue',
      'red } body { color: blue',
      'image-set("x.png" 1x)',
    ]) {
      const editor = makeEditor(cellDoc({ backgroundColor: color }));
      expect(editor.getHTML(), color).not.toMatch(/background-color/);
    }
  });

  it('legitimate values still render (font stacks with quotes and commas, rgb(), calc())', () => {
    const font = '"Malgun Gothic", \'Apple SD Gothic Neo\', sans-serif';
    const editor = makeEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { indent: 'calc(2em + 4px)' },
          content: [
            text('x', [{ type: 'textStyle', attrs: { fontFamily: font, color: 'rgb(1, 2, 3)' } }]),
          ],
        },
      ],
    });
    const html = editor.getHTML();
    expect(html).toContain(`font-family: ${font.replace(/"/g, '&quot;')}`);
    expect(html).toContain('text-indent: calc(2em + 4px)');
    expect(html).toMatch(/color: (rgb\(1, 2, 3\)|#010203)/);
  });
});

describe('insertDocument assets', () => {
  it('a malformed asset refuses the insert without throwing and without touching the document', () => {
    const resolver = createDocparserAssetResolver();
    const editor = makeEditor('<p>a</p>', { resolveAsset: resolver });
    const before = JSON.stringify(editor.getJSON());
    const image = { type: 'image', attrs: { src: 'asset:sha256:00' } };
    let ok: boolean | undefined;
    expect(() => {
      ok = editor.commands.insertDocument(
        { type: 'doc', content: [image] },
        { assets: [{ sha256: 'x' } as never] },
      );
    }).not.toThrow();
    expect(ok).toBe(false);
    expect(JSON.stringify(editor.getJSON())).toBe(before);
    expect(
      editor.can().insertDocument(
        { type: 'doc', content: [image] },
        {
          assets: [{ sha256: 'x' } as never],
        },
      ),
    ).toBe(false);
  });
});
