import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import type { ContentReport } from '../../src/guard/guard';
import { destroyEditors, makeEditor } from '../helpers/editor';
import { createEditorExtensions } from '../../src/index';

afterEach(destroyEditors);

/** A paste/drop event stub (jsdom has no `ClipboardEvent`; `pasteHTML` takes the event). */
const pasteEvent = () =>
  ({
    preventDefault() {},
    clipboardData: { files: [], getData: () => '' },
  }) as unknown as ClipboardEvent;

describe('pasted hostile markup is absent, allowed embeds kept', () => {
  it('an off-host iframe leaves no empty rawHtml block behind', () => {
    const editor = makeEditor('<p>a</p>');
    editor.view.pasteHTML(
      '<p>x</p><iframe src="https://evil.example.test/embed"></iframe><p>y</p>',
      pasteEvent(),
    );
    const raw: JSONContent[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'rawHtml') raw.push(node.toJSON() as JSONContent);
    });
    expect(raw).toEqual([]);
  });

  it('script, style, on-attributes, javascript: href and off-host iframes are absent', () => {
    const reports: ContentReport[] = [];
    const editor = makeEditor('<p>a</p>', { onContentReport: (r) => reports.push(r) });
    editor.view.pasteHTML(
      '<p>keep</p>' +
        '<script>alert(1)</script>' +
        '<style>p{color:red}</style>' +
        '<p onclick="evil()">click</p>' +
        '<a href="javascript:alert(1)">bad</a>' +
        '<img src="x" onerror="alert(1)">' +
        '<iframe src="https://evil.example.test/embed"></iframe>',
      pasteEvent(),
    );
    const json = JSON.stringify(editor.getJSON());
    const html = editor.getHTML();
    for (const needle of [
      'script',
      'alert(1)',
      '<style',
      'onclick',
      'javascript:',
      'onerror',
      'evil.example.test',
    ]) {
      expect(json).not.toContain(needle);
      expect(html).not.toContain(needle);
    }
    expect(json).toContain('keep');
  });

  it('allowed-host iframes are kept as rawHtml', () => {
    const reports: ContentReport[] = [];
    const editor = makeEditor('<p>a</p>', { onContentReport: (r) => reports.push(r) });
    editor.view.pasteHTML(
      '<p>keep</p><iframe src="https://www.youtube.com/embed/abc"></iframe>',
      pasteEvent(),
    );
    const types: string[] = [];
    editor.state.doc.descendants((node) => {
      types.push(node.type.name);
    });
    expect(types).toContain('rawHtml');
    expect(editor.getHTML()).toContain('https://www.youtube.com/embed/abc');
  });

  it('Word junk never reaches the document', () => {
    const editor = makeEditor('<p>a</p>');
    editor.view.pasteHTML(
      '<p class="MsoNormal">hi<o:p></o:p></p>' +
        '<p class="MsoListParagraphCxSpFirst" style="mso-list: l0 level1 lfo1;">' +
        '<span style="mso-list: ignore;">1.</span>one</p>' +
        '<p class="MsoListParagraphCxSpLast" style="mso-list: l0 level1 lfo1;">' +
        '<span style="mso-list: ignore;">2.</span>two</p>',
      pasteEvent(),
    );
    const json = JSON.stringify(editor.getJSON());
    expect(json).not.toContain('Mso');
    expect(json).not.toContain('mso-list');
    expect(json).not.toContain('o:p');
    const lists: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'orderedList') lists.push(node.type.name);
    });
    expect(lists).toEqual(['orderedList']);
  });
});

describe('pasted result only uses schema types and attributes', () => {
  it('every node, mark and attribute name in the result exists in the schema', () => {
    const editor = makeEditor('<p>a</p>');
    editor.view.pasteHTML(
      '<p class="MsoNormal" style="text-align: center; line-height: 1.6;">' +
        'Word <b>bold</b><o:p></o:p></p>' +
        '<p xmlns:hp="https://hancom.co.kr/hwpml/2011/paragraph">HWP <i>italic</i></p>' +
        '<div class="web"><ul><li>one</li><li>two</li></ul>' +
        '<table><tbody><tr><td style="background-color: #ffff00;">c</td></tr></tbody></table>' +
        '<p><a href="https://example.test/">link</a> ' +
        '<img src="https://example.test/i.png" alt="t"></p></div>',
      pasteEvent(),
    );
    const problems: string[] = [];
    const walk = (node: JSONContent): void => {
      if (!node || typeof node !== 'object') return;
      if (typeof node.type === 'string') {
        if (!editor.schema.nodes[node.type]) problems.push(`node ${node.type}`);
        for (const name of Object.keys(node.attrs ?? {})) {
          const spec = editor.schema.nodes[node.type]?.spec.attrs ?? {};
          if (!(name in spec) && name !== 'unsupportedAttrs')
            problems.push(`attr ${node.type}.${name}`);
        }
        for (const mark of node.marks ?? []) {
          if (mark.type && !editor.schema.marks[mark.type]) problems.push(`mark ${mark.type}`);
          for (const name of Object.keys(mark.attrs ?? {})) {
            const spec = mark.type ? (editor.schema.marks[mark.type]?.spec.attrs ?? {}) : {};
            if (!(name in spec)) problems.push(`mark attr ${mark.type}.${name}`);
          }
        }
      }
      for (const child of node.content ?? []) walk(child);
    };
    walk(editor.getJSON());
    expect(problems).toEqual([]);
  });
});

describe('pasted styles land on schema attributes', () => {
  /** First node of `type` whose subtree holds `text` (paste position is not indexed). */
  const findNode = (editor: Editor, type: string, text: string): JSONContent | null => {
    let found: JSONContent | null = null;
    const holds = (node: JSONContent): boolean => {
      if (!node || typeof node !== 'object') return false;
      // Pasted blocks may merge with the surrounding paragraph (`"xa"`): match by inclusion.
      if (node.type === 'text' && typeof node.text === 'string' && node.text.includes(text))
        return true;
      return (node.content ?? []).some(holds);
    };
    const walk = (node: JSONContent): void => {
      if (found || !node || typeof node !== 'object') return;
      if (node.type === type && holds(node)) found = node;
      for (const child of node.content ?? []) walk(child);
    };
    walk(editor.getJSON());
    return found;
  };

  it('paragraph lineHeight, indent and margins survive the paste', () => {
    // Two blocks: the first merges into the host paragraph (ProseMirror close behavior),
    // the second lands as its own block with its attributes.
    const editor = makeEditor('');
    editor.view.pasteHTML(
      '<p>before</p><p style="line-height: 1.6; text-indent: 10pt; margin-top: 6pt;">x</p>',
      pasteEvent(),
    );
    expect(findNode(editor, 'paragraph', 'x')?.attrs).toMatchObject({
      lineHeight: '1.6',
      indent: '10pt',
      spaceBefore: '6pt',
    });
  });

  it('text color, size and family survive the paste', () => {
    const editor = makeEditor('<p>a</p>');
    editor.view.pasteHTML(
      '<p><span style="color: #c00000; font-size: 14px; font-family: Arial;">x</span></p>',
      pasteEvent(),
    );
    const text = findNode(editor, 'text', 'x');
    const style = (text?.marks ?? []).find((mark) => mark.type === 'textStyle');
    expect(style?.attrs).toMatchObject({
      color: '#c00000',
      fontSize: '14px',
      fontFamily: 'Arial',
    });
  });

  it('cell background, border and span survive the paste', () => {
    const editor = makeEditor('<p>a</p>');
    editor.view.pasteHTML(
      '<table><tbody><tr><td colspan="2" style="background-color: #ffff00; ' +
        'border-top: 1pt solid #000000; vertical-align: top;">x</td></tr></tbody></table>',
      pasteEvent(),
    );
    expect(findNode(editor, 'tableCell', 'x')?.attrs).toMatchObject({
      colspan: 2,
      backgroundColor: '#ffff00',
      borderTop: '1pt solid #000000',
      verticalAlign: 'top',
    });
  });

  it('image src, alt and size survive the paste', () => {
    const editor = makeEditor('<p>a</p>');
    editor.view.pasteHTML(
      '<img src="https://example.test/i.png" alt="alt" width="200" height="100">',
      pasteEvent(),
    );
    const json = JSON.stringify(editor.getJSON());
    expect(json).toContain('https://example.test/i.png');
    expect(json).toContain('alt');
    expect(json).toContain('200');
  });
});

describe('AC-PST paste feature wiring', () => {
  it('features.paste false leaves paste to ProseMirror defaults', () => {
    const reports: ContentReport[] = [];
    const editor = makeEditor('<p>a</p>', {
      features: { paste: false },
      onContentReport: (r) => reports.push(r),
    });
    editor.view.pasteHTML(
      '<p class="MsoListParagraphCxSpFirst" style="mso-list: l0 level1 lfo1;">' +
        '<span style="mso-list: ignore;">1.</span>one</p>' +
        '<script>var dropped = 1;</script>',
      pasteEvent(),
    );
    expect(reports.filter((r) => r.unknownHtml.length > 0)).toEqual([]);
    const types: string[] = [];
    editor.state.doc.descendants((node) => {
      types.push(node.type.name);
    });
    expect(types).not.toContain('orderedList');
  });

  it('the normalizer plugin runs before the policy plugin', () => {
    const editor = makeEditor('<p>a</p>');
    const names = editor.state.plugins.map((plugin) =>
      String((plugin as unknown as { key?: unknown }).key),
    );
    const normalizer = names.findIndex((name) => name.includes('rcmPasteNormalizer'));
    const policy = names.findIndex((name) => name.includes('rcmPastePolicy'));
    expect(normalizer).toBeGreaterThanOrEqual(0);
    expect(policy).toBeGreaterThanOrEqual(0);
    expect(normalizer).toBeLessThan(policy);
  });

  it('normalizer output feeds the policy: drops reported once as unknownHtml', () => {
    const reports: ContentReport[] = [];
    const editor = makeEditor('<p>a</p>', { onContentReport: (r) => reports.push(r) });
    editor.view.pasteHTML('<p>keep</p><script>alert(1)</script>', pasteEvent());
    const unknown = reports.flatMap((r) => r.unknownHtml);
    expect(unknown.map((entry) => entry.tag)).toContain('script');
    expect(reports.every((r) => r.source === 'insertContent')).toBe(true);
    expect(reports.every((r) => r.format === 'html')).toBe(true);
    expect(reports.flatMap((r) => r.policyRemoved)).toEqual([]);
  });

  it('paste still inserts content with the default kit (no editor given)', () => {
    const editor: Editor = new Editor({
      extensions: createEditorExtensions(),
      content: '<p>a</p>',
    });
    try {
      editor.view.pasteHTML('<p>pasted</p>', pasteEvent());
      expect(JSON.stringify(editor.getJSON())).toContain('pasted');
    } finally {
      editor.destroy();
    }
  });
});
