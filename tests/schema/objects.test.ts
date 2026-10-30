import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor, JSONContent } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import {
  DEFAULT_PLACEHOLDER_LABELS,
  PLACEHOLDER_KINDS,
  PLACEHOLDER_REASONS,
} from '../../src/index';
import { diffDocs, formatDifferences } from '../helpers/json-equal';
import { destroyEditors, loadFixtures, makeEditor, pressKey } from '../helpers/editor';

const ASSET = 'asset:sha256:e93186cbb1ded04219e0ed30fa82ae5a501e6256d4717c893c54a9a1ab25a1a7';
const RESOLVED = 'blob:https://example.test/resolved-1';

const scrollCalls: Element[] = [];
const originalScroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');

afterEach(() => {
  destroyEditors();
  scrollCalls.length = 0;
  if (originalScroll) Object.defineProperty(Element.prototype, 'scrollIntoView', originalScroll);
  else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

function recordScroll() {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: function (this: Element) {
      scrollCalls.push(this);
    },
  });
}

const fixture = (name: string) => {
  const found = loadFixtures().find((f) => f.name === name);
  if (!found) throw new Error(`fixture ${name}`);
  return found.doc as JSONContent;
};
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });
const para = (text: string): JSONContent => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});
const image = (attrs: Record<string, unknown>): JSONContent => ({ type: 'image', attrs });

function expectSameDoc(actual: JSONContent, expected: JSONContent) {
  const diffs = diffDocs(expected, actual);
  expect(diffs, formatDifferences(diffs)).toEqual([]);
}
const htmlRoundTrip = (source: JSONContent) => makeEditor(makeEditor(source).getHTML()).getJSON();

function posOf(editor: Editor, type: string, index = 0): number {
  const found: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === type) found.push(pos);
    return true;
  });
  if (found[index] === undefined) throw new Error(`no ${type}[${index}]`);
  return found[index]!;
}

function selectNode(editor: Editor, pos: number) {
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('image', () => {
  it('src/alt/title/width/height survive JSON → HTML → JSON; width/height stay px integers', () => {
    const source = doc(image({ src: ASSET, alt: '그림', title: 't', width: 160, height: 120 }));
    const json = htmlRoundTrip(source);
    expectSameDoc(json, source);
    expect(json.content?.[0]?.attrs).toMatchObject({ width: 160, height: 120, src: ASSET });
  });

  it('a sync resolveAsset sets the DOM src; JSON and HTML keep the asset: src', () => {
    const resolveAsset = vi.fn(() => RESOLVED);
    const source = doc(image({ src: ASSET, width: 160, height: 120 }));
    const editor = makeEditor(source, { resolveAsset });
    expect(resolveAsset).toHaveBeenCalledWith(ASSET);
    const img = editor.view.dom.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(RESOLVED);
    expect(img.closest('[data-asset-state]')?.getAttribute('data-asset-state')).toBe('resolved');
    expect(editor.getJSON()).toEqual(makeEditor(source).getJSON());
    expect(editor.getHTML()).toContain(`src="${ASSET}"`);
    expect(editor.getHTML()).not.toContain(RESOLVED);
  });

  it('an async resolveAsset sets the DOM src when it resolves (features.image option)', async () => {
    let finish: (url: string) => void = () => {};
    const pending = new Promise<string>((resolve) => (finish = resolve));
    const editor = makeEditor(doc(image({ src: ASSET })), {
      features: { image: { resolveAsset: () => pending } },
    });
    const img = editor.view.dom.querySelector('img')!;
    const state = () => img.closest('[data-asset-state]')?.getAttribute('data-asset-state');
    expect(state()).toBe('pending');
    expect(img.hasAttribute('src')).toBe(false);
    finish(RESOLVED);
    await flush();
    expect(img.getAttribute('src')).toBe(RESOLVED);
    expect(state()).toBe('resolved');
    expect(editor.getJSON().content?.[0]?.attrs?.src).toBe(ASSET);
  });

  it('unresolved assets stay visible as missing; ordinary srcs bypass the resolver', () => {
    const resolveAsset = vi.fn((src: string) => (src === ASSET ? null : RESOLVED));
    const editor = makeEditor(
      doc(image({ src: ASSET }), image({ src: 'https://example.test/a.png' })),
      { resolveAsset, features: { image: { resize: false } } },
    );
    const [missing, plain] = Array.from(editor.view.dom.querySelectorAll('img'));
    expect(missing!.getAttribute('data-asset-state')).toBe('missing');
    expect(missing!.getAttribute('src')).toBe(ASSET);
    expect(plain!.getAttribute('src')).toBe('https://example.test/a.png');
    expect(resolveAsset).toHaveBeenCalledTimes(1);
  });

  it('align left/center/right/inline survives JSON → HTML → JSON; default stays absent', () => {
    const source = doc(
      ...(['left', 'center', 'right', 'inline'] as const).map((align) =>
        image({ src: 'https://example.test/a.png', align }),
      ),
      image({ src: 'https://example.test/b.png' }),
    );
    const json = htmlRoundTrip(source);
    expectSameDoc(json, source);
    expect(json.content?.[4]?.attrs?.align ?? null).toBeNull();
    const html = makeEditor(source).getHTML();
    expect(html.match(/data-align="/g)).toHaveLength(4);
  });

  it('align parses from data-align, align=, float and display:block + margin auto', () => {
    const alignOf = (html: string) => makeEditor(html).getJSON().content?.[0]?.attrs?.align ?? null;
    const src = 'src="https://example.test/a.png"';
    expect(alignOf(`<img ${src} data-align="inline">`)).toBe('inline');
    expect(alignOf(`<img ${src} align="right">`)).toBe('right');
    expect(alignOf(`<img ${src} style="float: left">`)).toBe('left');
    expect(alignOf(`<img ${src} style="display:block;margin:0 auto">`)).toBe('center');
    expect(alignOf(`<img ${src} style="display: inline-block">`)).toBe('inline');
    expect(alignOf(`<img ${src}>`)).toBeNull();
  });

  it('<img width=200 style="float:right"> + <figcaption> → width 200, right, figcaption node', () => {
    const single = makeEditor(
      '<img src="https://example.test/a.png" width=200 style="float:right">',
    );
    expect(single.getJSON().content?.[0]).toMatchObject({
      type: 'image',
      attrs: { width: 200, align: 'right' },
    });
    const figure = makeEditor(
      '<figure><img src="https://example.test/a.png" width=200 style="float:right"><figcaption>설명</figcaption></figure>',
    ).getJSON().content?.[0];
    expect(figure).toMatchObject({
      type: 'figure',
      content: [
        { type: 'image', attrs: { width: 200, align: 'right' } },
        { type: 'figcaption', content: [{ type: 'text', text: '설명' }] },
      ],
    });
  });

  it('the node view places the image per align (container data-align, float/inline)', () => {
    const editor = makeEditor(
      doc(
        image({ src: 'https://example.test/a.png', align: 'right' }),
        image({ src: 'https://example.test/a.png', align: 'inline' }),
      ),
    );
    const containers = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>('[data-resize-container]'),
    );
    expect(containers.map((c) => c.getAttribute('data-align'))).toEqual(['right', 'inline']);
    expect(containers[0]!.style.float).toBe('right');
    expect(containers[1]!.style.display).toBe('inline-flex');
    // the inner img does not carry the float (it would collapse the resize wrapper)
    expect(containers[0]!.querySelector('img')!.style.float).toBe('');
    editor.commands.command(({ tr }) => {
      tr.setNodeMarkup(posOf(editor, 'image'), undefined, {
        ...editor.state.doc.nodeAt(posOf(editor, 'image'))!.attrs,
        align: 'center',
      });
      return true;
    });
    const first = editor.view.dom.querySelector<HTMLElement>('[data-resize-container]')!;
    expect(first.getAttribute('data-align')).toBe('center');
    expect(first.style.float).toBe('');
    expect(first.style.justifyContent).toBe('center');
  });
});

describe('figure / figcaption', () => {
  it('toggleImageCaption wraps the selected image and toggling again restores the JSON', () => {
    const source = doc(
      para('a'),
      image({ src: ASSET, width: 160, height: 120, align: 'center' }),
      para('b'),
    );
    const editor = makeEditor(source);
    const original = editor.getJSON();
    selectNode(editor, posOf(editor, 'image'));
    expect(editor.commands.toggleImageCaption()).toBe(true);
    expect(editor.getJSON().content?.[1]).toMatchObject({
      type: 'figure',
      content: [{ type: 'image', attrs: { src: ASSET } }, { type: 'figcaption' }],
    });
    expect(editor.state.selection.$from.parent.type.name).toBe('figcaption');
    expect(editor.commands.toggleImageCaption()).toBe(true);
    expect(editor.getJSON()).toEqual(original);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  });

  it('toggleImageCaption without an image selection does nothing', () => {
    const editor = makeEditor(doc(para('a')));
    expect(editor.commands.toggleImageCaption()).toBe(false);
  });

  it('figure(image, figcaption) survives JSON → HTML → JSON; figures without img are not figures', () => {
    const source = doc({
      type: 'figure',
      content: [
        image({ src: ASSET, width: 10, height: 10 }),
        {
          type: 'figcaption',
          content: [{ type: 'text', text: '캡션', marks: [{ type: 'bold' }] }],
        },
      ],
    });
    expectSameDoc(htmlRoundTrip(source), source);
    // A figure without an image is not a figure node — and since the wrapper is kept as
    // rawHtml instead of being silently dropped.
    const other = makeEditor('<figure><blockquote><p>q</p></blockquote></figure>').getJSON();
    expect(other.content?.map((n) => n.type)).toEqual(['rawHtml']);
    expect(other.content?.[0]?.attrs?.html).toBe(
      '<figure><blockquote><p>q</p></blockquote></figure>',
    );
  });

  it('Enter in a caption leaves the figure into a new paragraph', () => {
    const editor = makeEditor(
      doc({
        type: 'figure',
        content: [
          image({ src: ASSET }),
          { type: 'figcaption', content: [{ type: 'text', text: 'c' }] },
        ],
      }),
    );
    editor.commands.setTextSelection(posOf(editor, 'figcaption') + 2);
    expect(pressKey(editor, 'Enter')).toBe(true);
    expect(editor.getJSON().content?.map((n) => n.type)).toEqual(['figure', 'paragraph']);
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
  });
});

describe('pageBreak', () => {
  it('pageBreak renders <div data-type="page-break" style="break-after: page"> and round-trips', () => {
    const source = doc(para('a'), { type: 'pageBreak' }, para('b'));
    const html = makeEditor(source).getHTML();
    const el = new DOMParser()
      .parseFromString(html, 'text/html')
      .querySelector<HTMLElement>('[data-type="page-break"]')!;
    expect(el.tagName).toBe('DIV');
    expect(el.style.getPropertyValue('break-after')).toBe('page');
    expectSameDoc(htmlRoundTrip(source), source);
  });

  it('legacy empty page-break elements parse as pageBreak; non-empty ones keep their style as rawHtml', () => {
    const types = (html: string) =>
      makeEditor(html)
        .getJSON()
        .content?.map((n) => n.type);
    expect(types('<p>a</p><div style="page-break-after: always"></div><p>b</p>')).toEqual([
      'paragraph',
      'pageBreak',
      'paragraph',
    ]);
    expect(types('<p>a</p><p style="break-before: page"></p><p>b</p>')).toEqual([
      'paragraph',
      'pageBreak',
      'paragraph',
    ]);
    expect(types('<p>a</p><br style="page-break-before: always"><p>b</p>')).toContain('pageBreak');
    // The break style would be silently dropped from a non-empty block: kept as rawHtml.
    expect(types('<p style="page-break-after: always">text</p>')).toEqual(['rawHtml']);
  });

  it('setPageBreak() inserts a page break at the cursor', () => {
    const editor = makeEditor(doc(para('ab')));
    editor.commands.setTextSelection(2);
    expect(editor.commands.setPageBreak()).toBe(true);
    expect(editor.getJSON().content?.map((n) => n.type)).toContain('pageBreak');
  });
});

describe('docparser nodes', () => {
  it('synthetic-objects and regulation survive JSON → HTML → JSON', () => {
    for (const name of ['synthetic-objects', 'regulation']) {
      const source = fixture(name);
      expectSameDoc(htmlRoundTrip(source), source);
    }
  });

  it('textBox view carries width, background and the four borders from attrs', () => {
    const editor = makeEditor(fixture('synthetic-objects'));
    const box = editor.view.dom.querySelector<HTMLElement>('[data-type="text-box"]')!;
    expect(box.style.width).toBe('300px');
    expect(box.style.backgroundColor).toBe('rgb(221, 235, 247)');
    for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const)
      expect(box.style[`border${side}Width`], side).toBe('0.3pt');
  });

  it('footnoteReference shows its label; clicking it scrolls to and selects the footnote', () => {
    recordScroll();
    const editor = makeEditor(fixture('synthetic-objects'));
    const ref = editor.view.dom.querySelector<HTMLElement>(
      'sup[data-type="footnote-reference"][data-id="en-1"]',
    )!;
    expect(ref.getAttribute('data-label')).toBe('1');
    ref.querySelector('a')!.click();
    expect(scrollCalls).toHaveLength(1);
    expect((scrollCalls[0] as HTMLElement).getAttribute('data-type')).toBe('footnote');
    expect((scrollCalls[0] as HTMLElement).getAttribute('data-id')).toBe('en-1');
    const { $from } = editor.state.selection;
    const footnote = [...Array($from.depth + 1).keys()]
      .map((d) => $from.node(d))
      .find((n) => n.type.name === 'footnote');
    expect(footnote?.attrs.id).toBe('en-1');
  });

  it('the footnote back link returns to its reference', () => {
    recordScroll();
    const editor = makeEditor(fixture('synthetic-objects'));
    const note = editor.view.dom.querySelector<HTMLElement>(
      '[data-type="footnote"][data-id="fn-1"]',
    )!;
    note.querySelector<HTMLElement>('.rcm-footnote-backlink')!.click();
    expect(scrollCalls).toHaveLength(1);
    expect((scrollCalls[0] as HTMLElement).getAttribute('data-id')).toBe('fn-1');
    expect((scrollCalls[0] as HTMLElement).getAttribute('data-type')).toBe('footnote-reference');
    const selection = editor.state.selection as NodeSelection;
    expect(selection.node.type.name).toBe('footnoteReference');
    expect(selection.node.attrs.id).toBe('fn-1');
    expect(editor.commands.goToFootnote('nope')).toBe(false);
  });

  it('equation: click opens the script editor, Enter applies, Escape cancels', () => {
    const editor = makeEditor(fixture('synthetic-objects'));
    const eq = () => editor.state.doc.nodeAt(posOf(editor, 'equation'))!;
    const dom = editor.view.dom.querySelector<HTMLElement>('[data-type="equation"]')!;
    expect(dom.textContent).toBe('x^2 + y^2 = z^2');

    dom.click();
    let input = dom.querySelector('textarea')!;
    expect(input.value).toBe('x^2 + y^2 = z^2');
    input.value = 'a over b';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(eq().attrs).toMatchObject({ script: 'a over b', format: 'hwp' });
    expect(dom.querySelector('textarea')).toBeNull();
    expect(editor.view.dom.querySelector('[data-type="equation"]')!.textContent).toBe('a over b');

    editor.view.dom.querySelector<HTMLElement>('[data-type="equation"]')!.click();
    input = editor.view.dom.querySelector('[data-type="equation"] textarea')!;
    input.value = 'discarded';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(eq().attrs.script).toBe('a over b');
    expect(editor.view.dom.querySelector('[data-type="equation"] textarea')).toBeNull();
  });

  it('equation: Enter on a selected equation opens the editor', () => {
    const editor = makeEditor(fixture('synthetic-objects'));
    selectNode(editor, posOf(editor, 'equation'));
    expect(pressKey(editor, 'Enter')).toBe(true);
    expect(editor.view.dom.querySelector('[data-type="equation"] textarea')).not.toBeNull();
  });

  it('placeholder: data-kind/data-reason in the view and a non-empty label for every combination', () => {
    const combos = PLACEHOLDER_KINDS.flatMap((kind) =>
      PLACEHOLDER_REASONS.map((reason) => ({ type: 'placeholder', attrs: { kind, reason } })),
    );
    const editor = makeEditor(
      doc(...combos, { type: 'placeholder', attrs: { kind: 'x', reason: 'y' } }),
    );
    const boxes = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>('[data-type="placeholder"]'),
    );
    expect(boxes).toHaveLength(combos.length + 1);
    boxes.forEach((box, i) => {
      const expected = combos[i]?.attrs ?? { kind: 'x', reason: 'y' };
      expect(box.getAttribute('data-kind')).toBe(expected.kind);
      expect(box.getAttribute('data-reason')).toBe(expected.reason);
      expect(box.querySelector('.rcm-placeholder-label')!.textContent!.trim()).not.toBe('');
      expect(box.querySelector('.rcm-placeholder-icon')).not.toBeNull();
    });
    // distinct reasons of one kind read differently
    const imageLabels = boxes
      .filter((b) => b.getAttribute('data-kind') === 'image')
      .map((b) => b.textContent);
    expect(new Set(imageLabels).size).toBe(PLACEHOLDER_REASONS.length);
  });

  it('placeholder labels are injectable; blank overrides fall back to a non-empty label', () => {
    const editor = makeEditor(
      doc(
        { type: 'placeholder', attrs: { kind: 'chart', reason: 'missing_binary' } },
        { type: 'placeholder', attrs: { kind: 'ole', reason: 'limit_exceeded' } },
      ),
      {
        features: {
          placeholder: {
            labels: {
              'chart.missing_binary': 'CHART-MISSING',
              template: '[{kind}|{reason}]',
              'kind.ole': 'OLE',
              'reason.limit_exceeded': '',
            },
          },
        },
      },
    );
    const [chart, ole] = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>('.rcm-placeholder-label'),
    ).map((el) => el.textContent);
    expect(chart).toBe('CHART-MISSING');
    expect(ole).toBe(`[OLE|${DEFAULT_PLACEHOLDER_LABELS['reason.limit_exceeded']}]`);
  });

  it('docparser nodes, figure and pageBreak can be disabled through features', () => {
    const editor = makeEditor('', {
      features: {
        footnotes: false,
        equation: false,
        placeholder: false,
        textBox: false,
        pageBreak: false,
        figure: false,
      },
    });
    for (const type of [
      'footnotes',
      'footnote',
      'footnoteReference',
      'equation',
      'placeholder',
      'textBox',
      'pageBreak',
      'figure',
      'figcaption',
    ])
      expect(editor.schema.nodes[type], type).toBeUndefined();
    expect('setPageBreak' in editor.commands).toBe(false);
    expect('toggleImageCaption' in editor.commands).toBe(false);
    // the empty-editor hint is a separate feature with its own name
    expect(editor.extensionManager.extensions.map((e) => e.name)).toContain('emptyPlaceholder');
  });
});
