import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import {
  DEFAULT_UNSUPPORTED_LABELS,
  getContentReport,
  getLosslessHTML,
  getLosslessJSON,
  handleContentError,
} from '../../src/index';
import type { ContentReport } from '../../src/index';
import { diffDocs, formatDifferences, stableStringify } from '../helpers/json-equal';
import { destroyEditors, makeEditor } from '../helpers/editor';

afterEach(destroyEditors);

const text = (t: string, marks?: JSONContent['marks']): JSONContent =>
  marks ? { type: 'text', text: t, marks } : { type: 'text', text: t };
const para = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const cell = (...content: JSONContent[]): JSONContent => ({
  type: 'tableCell',
  attrs: { colspan: 1, rowspan: 1 },
  content,
});

/** Canonical form of `doc` (what the editor emits), so injected docs can compare byte for byte. */
function canonical(doc: JSONContent): JSONContent {
  return getLosslessJSON(makeEditor(doc));
}

const UNKNOWN_BLOCK = {
  type: 'mysteryBlock',
  attrs: { variant: 'x', nested: { a: [1, 2] } },
  content: [para(text('inside unknown'))],
};
const UNKNOWN_INLINE = { type: 'mention', attrs: { id: 'u1', label: '@kim' } };
const UNKNOWN_MARK = { type: 'comment', attrs: { thread: 't9' } };

/** A doc exercising every injection position: block, inline, mark, attrs, nested in a table. */
function injectedDoc(): JSONContent {
  const base = canonical({
    type: 'doc',
    content: [
      para(text('before')),
      para(text('a'), text('b'), text('c')),
      {
        type: 'table',
        content: [{ type: 'tableRow', content: [cell(para(text('c1'))), cell(para(text('c2')))] }],
      },
      para(text('styled', [{ type: 'textStyle', attrs: { color: '#ff0000' } }])),
      para(text('after')),
    ],
  });
  const doc = structuredClone(base) as JSONContent & { content: JSONContent[] };
  // block, top level
  doc.content.splice(1, 0, UNKNOWN_BLOCK as JSONContent);
  // inline, between text runs ("a" [mention] "b" …)
  const p = doc.content[2]!;
  p.content = [
    text('a'),
    UNKNOWN_INLINE as JSONContent,
    text('bc', [UNKNOWN_MARK, { type: 'bold' }]),
  ];
  // unknown attribute on a known node
  p.attrs = { ...p.attrs, dataLegacy: 'keep-me' };
  // nested in a table cell: unknown block + unknown inline in the cell paragraph
  const row = doc.content[3]!.content![0]!;
  row.content![0]!.content!.push(UNKNOWN_BLOCK as JSONContent);
  row.content![1]!.content![0]!.content!.push(UNKNOWN_INLINE as JSONContent);
  // unknown attribute on a known mark
  const styled = doc.content[4]!.content![0]!;
  styled.marks![0]!.attrs = { ...styled.marks![0]!.attrs, fontWeight: '700' };
  return doc;
}

describe('content guard', () => {
  it('unknown nodes, marks and attributes at block, inline and table positions: document kept, originals restored byte for byte', () => {
    const doc = injectedDoc();
    const reports: ContentReport[] = [];
    const editor = makeEditor(doc, { onContentReport: (r) => reports.push(r) });

    // nothing emptied: every known text is still in the editor
    for (const t of ['before', 'bc', 'c1', 'c2', 'styled', 'after'])
      expect(editor.getText()).toContain(t);

    expect(stableStringify(getLosslessJSON(editor))).toBe(stableStringify(doc));

    expect(reports).toHaveLength(1);
    const listed = reports[0]!.unsupported.map((u) => `${u.kind}:${u.type}@${u.path}`);
    expect(listed).toEqual(
      expect.arrayContaining([
        'node:mysteryBlock@content[1](mysteryBlock)',
        'inline:mention@content[2](paragraph).content[1](mention)',
        'mark:comment@content[2](paragraph).content[2](text).marks[0](comment)',
        'attrs:paragraph@content[2](paragraph)',
        'node:mysteryBlock@content[3](table).content[0](tableRow).content[0](tableCell).content[1](mysteryBlock)',
        'inline:mention@content[3](table).content[0](tableRow).content[1](tableCell).content[0](paragraph).content[1](mention)',
        'attrs:textStyle@content[4](paragraph).content[0](text).marks[0](textStyle)',
      ]),
    );
    expect(reports[0]!.unsupported).toHaveLength(7);
    expect(getContentReport(editor)).toBe(reports[0]);
  });

  it('unsupported nodes render a visible, non-empty placeholder with data-unsupported-type', () => {
    const editor = makeEditor(injectedDoc());
    const blocks = editor.view.dom.querySelectorAll('[data-unsupported-type="mysteryBlock"]');
    const inlines = editor.view.dom.querySelectorAll('[data-unsupported-type="mention"]');
    expect(blocks).toHaveLength(2);
    expect(inlines).toHaveLength(2);
    for (const el of [...blocks, ...inlines]) {
      expect(el.textContent?.trim()).not.toBe('');
      expect(el.getAttribute('contenteditable')).toBe('false');
    }
    expect(inlines[0]!.tagName).toBe('SPAN');
    expect(blocks[0]!.textContent).toBe(
      DEFAULT_UNSUPPORTED_LABELS.block.replace('{type}', 'mysteryBlock'),
    );
  });

  it('placeholder labels are injectable', () => {
    const editor = makeEditor(injectedDoc(), {
      features: { contentGuard: { labels: { block: 'Unknown {type}', inline: '‹{type}›' } } },
    });
    const block = editor.view.dom.querySelector('[data-unsupported-type="mysteryBlock"]');
    const inline = editor.view.dom.querySelector('[data-unsupported-type="mention"]');
    expect(block?.textContent).toBe('Unknown mysteryBlock');
    expect(inline?.textContent).toBe('‹mention›');
  });

  it('setContent and insertContent go through the guard', () => {
    const doc = injectedDoc();
    const reports: ContentReport[] = [];
    const editor = makeEditor('<p>start</p>', { onContentReport: (r) => reports.push(r) });
    expect(editor.commands.setContent(doc)).toBe(true);
    expect(stableStringify(getLosslessJSON(editor))).toBe(stableStringify(doc));
    expect(reports.map((r) => r.source)).toEqual(['setContent']);

    editor.commands.setContent('<p>xy</p>');
    editor.commands.insertContentAt(2, UNKNOWN_INLINE as JSONContent);
    expect(getLosslessJSON(editor).content?.[0]?.content).toEqual([
      text('x'),
      UNKNOWN_INLINE,
      text('y'),
    ]);
    editor.commands.insertContentAt(editor.state.doc.content.size, UNKNOWN_BLOCK as JSONContent);
    expect(getLosslessJSON(editor).content?.[1]).toEqual(UNKNOWN_BLOCK);
    expect(reports.map((r) => r.source)).toEqual(['setContent', 'insertContent', 'insertContent']);
  });

  it('an invalid structure inside a table keeps the whole table as one unsupported node', () => {
    const table = {
      type: 'table',
      content: [{ type: 'tableRow', content: [para(text('not a cell'))] }],
    };
    const doc = { type: 'doc', content: [para(text('keep')), table] };
    const editor = makeEditor(doc);
    expect(editor.getText()).toContain('keep');
    expect(getLosslessJSON(editor).content?.[1]).toEqual(table);
    expect(getContentReport(editor)?.unsupported).toEqual([
      expect.objectContaining({ kind: 'invalid', type: 'table', path: 'content[1](table)' }),
    ]);
  });

  it('unsupported content survives JSON → HTML → JSON', () => {
    const doc = injectedDoc();
    const html = makeEditor(doc).getHTML();
    const back = getLosslessJSON(makeEditor(html));
    const diffs = diffDocs(doc, back);
    expect(diffs, formatDifferences(diffs)).toEqual([]);
  });

  it('editing next to unsupported content keeps it', () => {
    const doc = injectedDoc();
    const editor = makeEditor(doc);
    editor.commands.insertContentAt(1, 'X');
    const out = getLosslessJSON(editor);
    expect(out.content?.[0]?.content?.[0]?.text).toBe('Xbefore');
    expect(out.content?.[1]).toEqual(UNKNOWN_BLOCK);
  });

  it('a guard failure never empties the document: read-only, original retrievable, fatal report', () => {
    const cyclic: Record<string, unknown> = { type: 'mysteryBlock' };
    cyclic.self = cyclic;
    const doc = { type: 'doc', content: [para(text('keep')), cyclic] };
    const onContentReport = vi.fn();
    const editor = makeEditor(doc as JSONContent, { onContentReport });
    expect(editor.isEditable).toBe(false);
    expect(onContentReport).toHaveBeenCalledTimes(1);
    expect(onContentReport.mock.calls[0]![0].fatal?.message).toBeTruthy();
    expect(getLosslessJSON(editor)).toBe(doc);
    const holder = editor.view.dom.querySelector('[data-unsupported-fatal]');
    expect(holder?.textContent).toBe(DEFAULT_UNSUPPORTED_LABELS.fatal);
  });

  it('handleContentError (enableContentCheck net) makes the editor read-only and keeps the original', () => {
    const onContentReport = vi.fn();
    const original = { type: 'doc', content: [para(text('x'))] };
    const editor = makeEditor(original, { onContentReport });
    handleContentError({ editor, error: new Error('[tiptap error]: Invalid JSON content') });
    expect(editor.isEditable).toBe(false);
    expect(onContentReport.mock.calls[0]![0].fatal).toEqual({
      message: '[tiptap error]: Invalid JSON content',
    });
    expect(getLosslessJSON(editor)).toEqual(original);
  });

  it('HTML diagnostic: unknown elements become rawHtml, scripts are policy-removed', () => {
    const reports: ContentReport[] = [];
    const editor = makeEditor('<p>a</p>', { onContentReport: (r) => reports.push(r) });
    editor.commands.setContent(
      '<p>one</p><center>two</center><p><font color="red">three</font></p><script>evil()</script><div>plain</div>',
    );
    expect(editor.getText()).toContain('one');
    expect(reports).toHaveLength(1);
    expect(reports[0]!.format).toBe('html');
    // The policy removed the script (reported, not silent); nothing is left unpreserved.
    expect(reports[0]!.policyRemoved.map((u) => u.kind)).toEqual(['script']);
    expect(reports[0]!.unknownHtml).toEqual([]);
    expect(reports[0]!.rawHtml.map((u) => `${u.path}:${u.reason}`)).toEqual([
      '[1](center):element',
      '[2](p):element',
      '[3](div):element',
    ]);
    // Nothing silently lost: every source block is in the document verbatim.
    const html = getLosslessHTML(editor);
    for (const block of [
      '<p>one</p>',
      '<center>two</center>',
      '<p><font color="red">three</font></p>',
      '<div>plain</div>',
    ])
      expect(html).toContain(block);
    expect(html).not.toContain('evil()');
  });

  it('preprocessHtml hook (rawHtml) runs before parsing; JSON results are guarded', () => {
    const preprocessHtml = vi.fn(() => ({ type: 'doc', content: [UNKNOWN_BLOCK as JSONContent] }));
    const editor = makeEditor('<p>a</p>', { features: { contentGuard: { preprocessHtml } } });
    expect(preprocessHtml).toHaveBeenCalledWith(
      '<p>a</p>',
      expect.objectContaining({ source: 'initial' }),
    );
    expect(getLosslessJSON(editor).content).toEqual([UNKNOWN_BLOCK]);
  });

  it('without unsupported content the report is empty and getLosslessJSON equals getJSON minus guard attrs', () => {
    const onContentReport = vi.fn();
    const editor = makeEditor({ type: 'doc', content: [para(text('x'))] }, { onContentReport });
    expect(onContentReport).not.toHaveBeenCalled();
    expect(getContentReport(editor)?.unsupported).toEqual([]);
    const plain = editor.getJSON();
    const diffs = diffDocs(plain, getLosslessJSON(editor));
    expect(diffs).toEqual([]);
    expect(JSON.stringify(getLosslessJSON(editor))).not.toContain('unsupported');
  });
});
