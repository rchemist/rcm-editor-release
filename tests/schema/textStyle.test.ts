import { afterEach, describe, expect, it } from 'vitest';
import type { Editor, JSONContent } from '@tiptap/core';
import { diffDocs, formatDifferences } from '../helpers/json-equal';
import { destroyEditors, makeEditor } from '../helpers/editor';

afterEach(destroyEditors);

const STACK = '"함초롬돋움", "HCR Dotum", "Noto Sans KR", sans-serif';

const styled = (marks: JSONContent['marks'], text = 'x'): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text, marks }] }],
});

const marksOf = (editor: Editor) => editor.getJSON().content?.[0]?.content?.[0]?.marks ?? [];
const textStyleOf = (editor: Editor) =>
  marksOf(editor).find((m) => m.type === 'textStyle')?.attrs ?? {};

function expectHtmlRoundTrip(source: JSONContent) {
  const html = makeEditor(source).getHTML();
  const back = makeEditor(html).getJSON();
  const diffs = diffDocs(source, back);
  expect(diffs, `${html}\n${formatDifferences(diffs)}`).toEqual([]);
}

describe('textStyle attributes', () => {
  it('fontFamily (full stack), fontSize, color, letterSpacing, fontStretch survive JSON → HTML → JSON', () => {
    expectHtmlRoundTrip(
      styled([
        {
          type: 'textStyle',
          attrs: {
            fontFamily: STACK,
            fontSize: '12pt',
            color: '#1f4e79',
            letterSpacing: '-0.05em',
            fontStretch: '90%',
          },
        },
        { type: 'highlight', attrs: { color: '#e2efda' } },
      ]),
    );
  });

  it('each attribute alone round-trips without picking up empty siblings', () => {
    const cases: Record<string, string> = {
      fontFamily: STACK,
      fontSize: '14px',
      color: '#c00000',
      backgroundColor: '#ffff00',
      letterSpacing: '0.1em',
      fontStretch: '120%',
    };
    for (const [name, value] of Object.entries(cases)) {
      expectHtmlRoundTrip(styled([{ type: 'textStyle', attrs: { [name]: value } }]));
    }
  });

  it('parses letter-spacing / font-stretch from inline style, raw', () => {
    const editor = makeEditor(
      '<p><span style="letter-spacing: -0.05em; font-stretch: 90%">x</span></p>',
    );
    expect(textStyleOf(editor)).toMatchObject({ letterSpacing: '-0.05em', fontStretch: '90%' });
  });

  it('font stack string is byte-identical after HTML parse', () => {
    const editor = makeEditor(`<p><span style='font-family: ${STACK}'>x</span></p>`);
    expect(textStyleOf(editor).fontFamily).toBe(STACK);
  });

  it('opaque rgb() colours parse to lowercase #rrggbb (text, background, highlight)', () => {
    const editor = makeEditor(
      '<p><span style="color: rgb(31, 78, 121); background-color: #FFFF00">a</span>' +
        '<mark style="background-color: rgb(226, 239, 218)">b</mark></p>',
    );
    const [a, b] = editor.getJSON().content?.[0]?.content ?? [];
    expect(a?.marks?.find((m) => m.type === 'textStyle')?.attrs).toMatchObject({
      color: '#1f4e79',
      backgroundColor: '#ffff00',
    });
    expect(b?.marks?.find((m) => m.type === 'highlight')?.attrs?.color).toBe('#e2efda');
  });
});

describe('setFontSize', () => {
  it('pt is the default unit; explicit units are kept', () => {
    const editor = makeEditor('<p>abc</p>');
    editor.commands.selectAll();
    editor.commands.setFontSize('12');
    expect(textStyleOf(editor).fontSize).toBe('12pt');
    editor.commands.setFontSize('10.5pt');
    expect(textStyleOf(editor).fontSize).toBe('10.5pt');
    editor.commands.setFontSize('16px');
    expect(textStyleOf(editor).fontSize).toBe('16px');
  });

  it('existing px content stays px through JSON and HTML', () => {
    const source = styled([{ type: 'textStyle', attrs: { fontSize: '14px' } }]);
    expect(textStyleOf(makeEditor(source)).fontSize).toBe('14px');
    expectHtmlRoundTrip(source);
  });
});
