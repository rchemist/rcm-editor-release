// per-source paste fixtures (fixtures/paste/*) against expected JSON.
// The expected JSON was reviewed attribute by attribute against each source HTML.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JSONContent } from '@tiptap/core';
import { destroyEditors, makeEditor } from '../helpers/editor';
import { classifyHwpClipboardProvenance } from '../../src/paste/normalize';

afterEach(destroyEditors);

/** A paste/drop event stub (jsdom has no `ClipboardEvent`; `pasteHTML` takes the event). */
const pasteEvent = () =>
  ({
    preventDefault() {},
    clipboardData: { files: [], getData: () => '' },
  }) as unknown as ClipboardEvent;

// vitest runs with the package root as cwd (`import.meta.url` is http-scheme under jsdom).
const FIXTURES = join(process.cwd(), 'fixtures/paste');

const fixtureHtml = (name: string): string => readFileSync(join(FIXTURES, `${name}.html`), 'utf8');

/** `getJSON().content` after pasting `fixtures/paste/<name>.html` into an empty document. */
function pastedContent(name: string): JSONContent[] {
  const editor = makeEditor('');
  editor.view.pasteHTML(fixtureHtml(name), pasteEvent());
  return (editor.getJSON().content ?? []) as JSONContent[];
}

const expectedContent = (name: string): JSONContent[] =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as JSONContent[];

/** The textStyle mark attrs of a block's first text node (single-run fixtures). */
function textStyleOf(node: JSONContent | undefined): JSONContent | undefined {
  const text = (node?.content ?? []).find((child) => child.type === 'text');
  return (text?.marks ?? []).find((mark) => mark.type === 'textStyle')?.attrs;
}

describe('Word fixture pastes equal the expected JSON', () => {
  it('word/paragraphs: class rules inlined, mso-* mapped to schema attributes', () => {
    expect(pastedContent('word/paragraphs')).toEqual(expectedContent('word/paragraphs'));
  });

  it('word/table: shading, borders, colwidth, merge and alignment', () => {
    expect(pastedContent('word/table')).toEqual(expectedContent('word/table'));
  });
});

describe('HWP fixture pastes are detected as HWP and equal the expected JSON', () => {
  it('hwp/document: Hanword generator meta classifies hwp', () => {
    expect(classifyHwpClipboardProvenance(fixtureHtml('hwp/document'))).toBe('hwp');
    expect(pastedContent('hwp/document')).toEqual(expectedContent('hwp/document'));
  });

  it('hwp/hwpx: paragraph namespace classifies hwpx', () => {
    expect(classifyHwpClipboardProvenance(fixtureHtml('hwp/hwpx'))).toBe('hwpx');
    expect(pastedContent('hwp/hwpx')).toEqual(expectedContent('hwp/hwpx'));
  });
});

describe('web fixture pastes keep inline styles and map figure/figcaption', () => {
  it('web/paragraphs: inline styles kept on paragraph attributes and marks', () => {
    expect(pastedContent('web/paragraphs')).toEqual(expectedContent('web/paragraphs'));
  });

  it('web/figure: figure maps to the schema figure node (image + figcaption)', () => {
    const content = pastedContent('web/figure');
    expect(content).toEqual(expectedContent('web/figure'));
    const figure = content[0];
    expect(figure?.type).toBe('figure');
    expect((figure?.content ?? []).map((child) => child.type)).toEqual(['image', 'figcaption']);
  });
});

describe('Google Docs fixture pastes equal the expected JSON', () => {
  it('gdocs/paragraphs: wrapper stripped, span styles mapped to marks', () => {
    expect(pastedContent('gdocs/paragraphs')).toEqual(expectedContent('gdocs/paragraphs'));
  });

  it('gdocs/list: list items keep their text styles', () => {
    expect(pastedContent('gdocs/list')).toEqual(expectedContent('gdocs/list'));
  });
});

describe('two styled web paragraphs paste as two paragraphs', () => {
  const TWO_PARAGRAPHS =
    '<p style="font-size: 14pt; color: #c00000; line-height: 1.5">첫 문단</p>' +
    '<p style="font-size: 11pt; color: #1f3864; line-height: 18pt">둘째 문단</p>';

  it('into an empty document: two paragraphs, each keeping lineHeight and text style', () => {
    const editor = makeEditor('');
    editor.view.pasteHTML(TWO_PARAGRAPHS, pasteEvent());
    const content = (editor.getJSON().content ?? []) as JSONContent[];
    expect(content).toHaveLength(2);
    expect(content.map((node) => node.type)).toEqual(['paragraph', 'paragraph']);
    expect(content[0]?.attrs?.lineHeight).toBe('1.5');
    expect(content[1]?.attrs?.lineHeight).toBe('18pt');
    expect(textStyleOf(content[0])).toMatchObject({ fontSize: '14pt', color: '#c00000' });
    expect(textStyleOf(content[1])).toMatchObject({ fontSize: '11pt', color: '#1f3864' });
  });

  it('into a paragraph with text: the styled paragraphs do not merge into the host', () => {
    const editor = makeEditor('<p>앞 문단</p>');
    editor.view.pasteHTML(TWO_PARAGRAPHS, pasteEvent());
    const content = (editor.getJSON().content ?? []) as JSONContent[];
    expect(content).toHaveLength(3);
    expect(content.map((node) => node.type)).toEqual(['paragraph', 'paragraph', 'paragraph']);
    // The cursor sits at the start of the host, so the split is [first, second, host].
    expect(content[0]?.attrs?.lineHeight).toBe('1.5');
    expect(content[1]?.attrs?.lineHeight).toBe('18pt');
    expect(content[2]?.attrs?.lineHeight).toBeNull();
    expect(textStyleOf(content[0])).toMatchObject({ fontSize: '14pt', color: '#c00000' });
    expect(textStyleOf(content[1])).toMatchObject({ fontSize: '11pt', color: '#1f3864' });
  });

  it('a single pasted paragraph into text merges inline (no host split)', () => {
    const editor = makeEditor('<p>앞뒤</p>');
    editor.commands.setTextSelection(2);
    editor.view.pasteHTML('<p class="MsoNormal" style="line-height: 1.5">낱말</p>', pasteEvent());
    const content = (editor.getJSON().content ?? []) as JSONContent[];
    expect(content).toHaveLength(1);
    expect(editor.state.doc.textContent).toBe('앞낱말뒤');
  });
});
