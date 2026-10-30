import { afterEach, describe, expect, it } from 'vitest';
import type { Editor, JSONContent } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { diffDocs, formatDifferences } from '../helpers/json-equal';
import { destroyEditors, loadFixtures, makeEditor, pressKey } from '../helpers/editor';

afterEach(destroyEditors);

const ATTRS = ['indent', 'marginLeft', 'marginRight', 'spaceBefore', 'spaceAfter', 'lineHeight'];

function expectSameDoc(actual: JSONContent, expected: JSONContent) {
  const diffs = diffDocs(expected, actual);
  expect(diffs, formatDifferences(diffs)).toEqual([]);
}

/** JSON → HTML → JSON through a fresh editor. */
function htmlRoundTrip(doc: JSONContent): { html: string; json: JSONContent } {
  const html = makeEditor(doc).getHTML();
  return { html, json: makeEditor(html).getJSON() };
}

const para = (attrs: Record<string, string>, text = 'x'): JSONContent => ({
  type: 'paragraph',
  attrs,
  content: [{ type: 'text', text }],
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

/** Puts the cursor inside the first textblock whose text equals `text`. */
function cursorIn(editor: Editor, text: string): void {
  let target = -1;
  editor.state.doc.descendants((node, pos) => {
    if (target < 0 && node.isTextblock && node.textContent === text) target = pos + 1;
    return target < 0;
  });
  if (target < 0) throw new Error(`no textblock "${text}"`);
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, target)),
  );
}

const firstAttrs = (editor: Editor) => editor.getJSON().content?.[0]?.attrs ?? {};

describe('paragraph/heading attributes', () => {
  it('synthetic-paragraph survives JSON → HTML → JSON (including the literal tab)', () => {
    const fixture = loadFixtures().find((f) => f.name === 'synthetic-paragraph');
    expect(fixture).toBeDefined();
    const { json } = htmlRoundTrip(fixture!.doc);
    expectSameDoc(json, fixture!.doc);
  });

  it('literal tab characters survive JSON → HTML → JSON', () => {
    const bold = [{ type: 'bold' }];
    const source = doc(
      para({}, 'a\tb'),
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '\t\tlead', marks: bold },
          { type: 'text', text: ' x\ty' },
        ],
      },
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'h\t1' }] },
    );
    const { html, json } = htmlRoundTrip(source);
    // tabs only: the wrapper is a white-space span; text without tabs renders unchanged
    expect(html).toContain('<span style="white-space: pre-wrap">a\tb</span>');
    expect(html).toContain('<strong><span style="white-space: pre-wrap">\t\tlead</span></strong>');
    expect(makeEditor(doc(para({}, 'plain'))).getHTML()).not.toContain('white-space');
    expectSameDoc(json, source);
    // no empty textStyle mark from the wrapper span
    expect(JSON.stringify(json)).not.toContain('textStyle');
  });

  it('every attribute renders as inline style and parses back on paragraph and heading', () => {
    const attrs = {
      indent: '-15pt',
      marginLeft: '30pt',
      marginRight: '20pt',
      spaceBefore: '6pt',
      spaceAfter: '9pt',
      lineHeight: '1.6',
      textAlign: 'justify',
    };
    const source = doc(para(attrs), {
      type: 'heading',
      attrs: { level: 2, ...attrs },
      content: [{ type: 'text', text: 'h' }],
    });
    const { html, json } = htmlRoundTrip(source);
    const p = new DOMParser().parseFromString(html, 'text/html').querySelector('p') as HTMLElement;
    expect(p.style.textIndent).toBe('-15pt');
    expect(p.style.marginLeft).toBe('30pt');
    expect(p.style.marginRight).toBe('20pt');
    expect(p.style.marginTop).toBe('6pt');
    expect(p.style.marginBottom).toBe('9pt');
    expect(p.style.lineHeight).toBe('1.6');
    expectSameDoc(json, source);
  });

  it('values keep their unit: pt stays pt, px stays px, ratio stays unitless', () => {
    const editor = makeEditor(
      '<p style="margin-left: 20px; margin-right: 7.5pt; text-indent: 12px; margin-top: 3pt; margin-bottom: 4px; line-height: 18pt">a</p>' +
        '<p style="line-height: 1.3">b</p>',
    );
    const [a, b] = editor.getJSON().content ?? [];
    expect(a?.attrs).toMatchObject({
      marginLeft: '20px',
      marginRight: '7.5pt',
      indent: '12px',
      spaceBefore: '3pt',
      spaceAfter: '4px',
      lineHeight: '18pt',
    });
    expect(b?.attrs?.lineHeight).toBe('1.3');
    // and back out unchanged
    const reparsed = makeEditor(editor.getHTML()).getJSON();
    expectSameDoc(reparsed, editor.getJSON());
  });

  it('absent attributes stay absent (no default style emitted)', () => {
    const editor = makeEditor('<p>plain</p>');
    for (const a of ATTRS) expect(firstAttrs(editor)[a]).toBeNull();
    expect(editor.getHTML()).toBe('<p>plain</p>');
  });
});

describe('setLineHeight / unsetLineHeight', () => {
  it('setLineHeight("1.6") sets the paragraph attr and HTML line-height', () => {
    const editor = makeEditor(doc(para({}, 'a')));
    cursorIn(editor, 'a');
    expect(editor.commands.setLineHeight('1.6')).toBe(true);
    expect(firstAttrs(editor).lineHeight).toBe('1.6');
    // on the block, not as a textStyle mark
    expect(editor.getJSON().content?.[0]?.content?.[0]?.marks).toBeUndefined();
    const p = new DOMParser()
      .parseFromString(editor.getHTML(), 'text/html')
      .querySelector('p') as HTMLElement;
    expect(p.style.lineHeight).toBe('1.6');
  });

  it('applies to every selected paragraph/heading and unsets', () => {
    const editor = makeEditor('<h2>h</h2><p>a</p><p>b</p>');
    editor.commands.selectAll();
    editor.commands.setLineHeight('18pt');
    expect(editor.getJSON().content?.map((n) => n.attrs?.lineHeight)).toEqual([
      '18pt',
      '18pt',
      '18pt',
    ]);
    editor.commands.unsetLineHeight();
    expect(editor.getJSON().content?.map((n) => n.attrs?.lineHeight)).toEqual([null, null, null]);
  });
});

describe('indent / outdent', () => {
  it('indent then outdent restores the original JSON (docparser pt values)', () => {
    const fixture = loadFixtures().find((f) => f.name === 'synthetic-paragraph')!;
    const editor = makeEditor(fixture.doc);
    editor.commands.selectAll();
    expect(editor.commands.indent()).toBe(true);
    expect(diffDocs(fixture.doc, editor.getJSON()).length).toBeGreaterThan(0);
    expect(editor.commands.outdent()).toBe(true);
    expectSameDoc(editor.getJSON(), fixture.doc);
  });

  it('steps marginLeft by 10pt, keeps px in px, removes the attr at 0', () => {
    const editor = makeEditor(
      doc(para({}, 'none'), para({ marginLeft: '30pt' }, 'pt'), para({ marginLeft: '20px' }, 'px')),
    );
    const margins = () => editor.getJSON().content?.map((n) => n.attrs?.marginLeft);
    editor.commands.selectAll();
    editor.commands.indent();
    expect(margins()).toEqual(['10pt', '40pt', '33.33px']);
    editor.commands.outdent();
    expect(margins()).toEqual([null, '30pt', '20px']);

    cursorIn(editor, 'none');
    expect(editor.commands.outdent()).toBe(false); // clamp: nothing below 0
    expect(margins()).toEqual([null, '30pt', '20px']);
  });

  it('indent step is configurable', () => {
    const editor = makeEditor(doc(para({}, 'a')), {
      features: { paragraphAttributes: { indentStep: '5pt' } },
    });
    cursorIn(editor, 'a');
    editor.commands.indent();
    expect(firstAttrs(editor).marginLeft).toBe('5pt');
  });

  it('Tab / Shift-Tab outside lists indent and outdent', () => {
    const editor = makeEditor(doc(para({}, 'a')));
    cursorIn(editor, 'a');
    expect(pressKey(editor, 'Tab')).toBe(true);
    expect(firstAttrs(editor).marginLeft).toBe('10pt');
    expect(pressKey(editor, 'Tab', { shiftKey: true })).toBe(true);
    expect(firstAttrs(editor).marginLeft).toBeNull();
  });

  it('Tab inside a list nests the item and leaves paragraph attrs unchanged', () => {
    const editor = makeEditor('<ul><li><p>one</p></li><li><p>two</p></li></ul>');
    cursorIn(editor, 'two');
    expect(pressKey(editor, 'Tab')).toBe(true);
    const list: JSONContent | undefined = editor.getJSON().content?.[0];
    const first: JSONContent | undefined = list?.content?.[0];
    expect(list?.content).toHaveLength(1);
    expect(first?.content?.[1]?.type).toBe('bulletList');
    let attrsTouched = false;
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'paragraph' && n.attrs.marginLeft != null) attrsTouched = true;
    });
    expect(attrsTouched).toBe(false);

    // Shift-Tab lifts it back
    cursorIn(editor, 'two');
    expect(pressKey(editor, 'Tab', { shiftKey: true })).toBe(true);
    expect(editor.getJSON().content?.[0]?.content).toHaveLength(2);
  });

  it('indent() command inside a list sinks the item instead of setting marginLeft', () => {
    const editor = makeEditor('<ul><li><p>one</p></li><li><p>two</p></li></ul>');
    cursorIn(editor, 'two');
    expect(editor.commands.indent()).toBe(true);
    expect(editor.getJSON().content?.[0]?.content).toHaveLength(1);
    expect(editor.commands.outdent()).toBe(true);
    expect(editor.getJSON().content?.[0]?.content).toHaveLength(2);
  });

  it('Tab inside a table cell is left to the table (no marginLeft)', () => {
    const editor = makeEditor(
      '<table><tbody><tr><td><p>c1</p></td><td><p>c2</p></td></tr></tbody></table>',
    );
    cursorIn(editor, 'c1');
    pressKey(editor, 'Tab');
    let indented = false;
    editor.state.doc.descendants((n) => {
      if (n.attrs.marginLeft != null) indented = true;
    });
    expect(indented).toBe(false);
    expect(editor.state.selection.$from.parent.textContent).toBe('c2');
  });
});
