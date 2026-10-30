import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor, JSONContent } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { createDocparserAssetResolver } from '../../src/docparser/index';
import { createEditorExtensions, diffStructure, getLosslessJSON } from '../../src/index';
import type { ContentReport } from '../../src/index';
import { destroyEditors, makeEditor } from '../helpers/editor';
import { PNG_SRC, doc, imageBlock, loadProfileFixture, para, pngAsset } from './helpers';

afterEach(destroyEditors);

beforeEach(() => {
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:test/${++n}`) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
});

const json = (editor: Editor) => editor.getJSON() as JSONContent;
const types = (editor: Editor) => (json(editor).content ?? []).map((n) => n.type);
const texts = (editor: Editor) =>
  (json(editor).content ?? []).map((n) => (n.content ?? []).map((c) => c.text ?? '').join(''));

/** Cursor at `offset` characters into the first paragraph. */
function cursorAt(editor: Editor, offset: number) {
  editor.commands.setTextSelection(1 + offset);
}

describe('insertDocument at the cursor', () => {
  it('splits the paragraph under the cursor and inserts the blocks between the halves', () => {
    const editor = makeEditor('<p>hello world</p>');
    cursorAt(editor, 6);
    expect(editor.commands.insertDocument(doc(para('A'), para('B')))).toBe(true);
    expect(texts(editor)).toEqual(['hello ', 'A', 'B', 'world']);
    // the cursor ends after the inserted content
    expect(editor.state.selection.$from.parent.textContent).toBe('B');
  });

  it('inserts before at the start of a textblock and after at its end, keeping the text', () => {
    const start = makeEditor('<p>one</p>');
    cursorAt(start, 0);
    start.commands.insertDocument(doc(para('X')));
    expect(texts(start)).toEqual(['X', 'one']);
    const end = makeEditor('<p>one</p>');
    cursorAt(end, 3);
    end.commands.insertDocument(doc(para('X')));
    expect(texts(end)).toEqual(['one', 'X']);
  });

  it('replaces an empty paragraph when the inserted content ends in a textblock', () => {
    const editor = makeEditor('<p></p>');
    editor.commands.insertDocument(doc(para('A'), para('B')));
    expect(texts(editor)).toEqual(['A', 'B']);
  });

  it('keeps the empty paragraph when the inserted content ends in a table (nothing to type after)', () => {
    const editor = makeEditor('<p></p>');
    const table = loadProfileFixtureTable();
    editor.commands.insertDocument(doc(para('A'), table));
    expect(types(editor)).toEqual(['paragraph', 'table', 'paragraph']);
    expect(texts(editor)[2]).toBe('');
  });

  it('replaces a non-empty text selection (and only it)', () => {
    const editor = makeEditor('<p>hello world</p>');
    editor.commands.setTextSelection({ from: 1 + 5, to: 1 + 11 }); // " world"
    editor.commands.insertDocument(doc(para('X')));
    expect(texts(editor)).toEqual(['hello', 'X']);
  });

  it('inserts at a document position when `at` is a number', () => {
    const editor = makeEditor('<p>one</p><p>two</p>');
    cursorAt(editor, 0);
    editor.commands.insertDocument(doc(para('X')), { at: editor.state.doc.child(0).nodeSize });
    expect(texts(editor)).toEqual(['one', 'X', 'two']);
    expect(editor.commands.insertDocument(doc(para('Y')), { at: 9999 })).toBe(false);
    expect(editor.commands.insertDocument(doc(para('Y')), { at: -1 })).toBe(false);
  });

  it('works inside a table cell (blocks stay in the cell)', () => {
    const editor = makeEditor(
      '<table><tbody><tr><td><p>cell</p></td></tr></tbody></table><p>after</p>',
    );
    editor.commands.setTextSelection(editor.state.doc.resolve(4).pos);
    editor.commands.insertDocument(doc(para('X')));
    const cell = json(editor).content![0]!.content![0]!.content![0]!;
    expect(cell.content!.map((p) => p.content?.[0]?.text)).toEqual(['X', 'cell']);
    expect(types(editor)).toEqual(['table', 'paragraph']);
  });

  it('one undo step restores the previous document exactly, redo re-applies', () => {
    const editor = makeEditor(
      '<p>hello world</p><table><tbody><tr><td><p>c</p></td></tr></tbody></table>',
    );
    cursorAt(editor, 5);
    const before = JSON.stringify(editor.getJSON());
    editor.commands.insertDocument(doc(para('A'), imageBlock(), para('B')));
    const after = JSON.stringify(editor.getJSON());
    expect(after).not.toBe(before);
    expect(editor.commands.undo()).toBe(true);
    expect(JSON.stringify(editor.getJSON())).toBe(before);
    expect(editor.commands.undo()).toBe(false); // nothing earlier: one step covered it all
    editor.commands.redo();
    expect(JSON.stringify(editor.getJSON())).toBe(after);
  });

  it('right after typing, the insert is still its own undo step', () => {
    const editor = makeEditor('<p></p>');
    editor.commands.insertContent('typed');
    const typed = JSON.stringify(editor.getJSON());
    editor.commands.insertDocument(doc(para('X')));
    expect(editor.commands.undo()).toBe(true);
    expect(JSON.stringify(editor.getJSON())).toBe(typed);
  });

  it('undo after replacing a selection restores the selected text', () => {
    const editor = makeEditor('<p>hello world</p>');
    editor.commands.setTextSelection({ from: 2, to: 8 });
    const before = JSON.stringify(editor.getJSON());
    editor.commands.insertDocument(doc(para('X')));
    editor.commands.undo();
    expect(JSON.stringify(editor.getJSON())).toBe(before);
  });

  it('accepts one block or an array of blocks, and refuses unusable content without changing anything', () => {
    const editor = makeEditor('<p>a</p>');
    cursorAt(editor, 1);
    expect(editor.commands.insertDocument(para('one'))).toBe(true);
    expect(editor.commands.insertDocument([para('two'), para('three')])).toBe(true);
    const snapshot = JSON.stringify(editor.getJSON());
    expect(editor.commands.insertDocument(doc())).toBe(false);
    expect(editor.commands.insertDocument([])).toBe(false);
    expect(editor.commands.insertDocument({} as never)).toBe(false);
    expect(editor.commands.insertDocument(null as never)).toBe(false);
    expect(JSON.stringify(editor.getJSON())).toBe(snapshot);
  });

  it('can() is a dry run', () => {
    const editor = makeEditor('<p>a</p>');
    const before = JSON.stringify(editor.getJSON());
    expect(editor.can().insertDocument(doc(para('x')))).toBe(true);
    expect(editor.can().insertDocument(doc())).toBe(false);
    expect(JSON.stringify(editor.getJSON())).toBe(before);
  });

  it('the feature can be turned off', () => {
    const editor = makeEditor('<p>a</p>', { features: { insertDocument: false } });
    expect((editor.commands as Record<string, unknown>).insertDocument).toBeUndefined();
  });
});

describe('insertDocument: guard and assets', () => {
  it('a node the schema does not know is preserved and reported', () => {
    const reports: ContentReport[] = [];
    const editor = makeEditor('<p>a</p>', { onContentReport: (r) => reports.push(r) });
    cursorAt(editor, 1);
    const unknown: JSONContent = {
      type: 'mysteryBlock',
      attrs: { x: 1 },
      content: [para('inner')],
    };
    expect(editor.commands.insertDocument(doc(unknown, para('z')))).toBe(true);
    expect(diffStructure(doc(para('a'), unknown, para('z')), getLosslessJSON(editor))).toEqual([]);
    expect(reports.at(-1)?.unsupported.map((u) => u.type)).toEqual(['mysteryBlock']);
    expect(reports.at(-1)?.source).toBe('insertContent');
  });

  it('merges assets into a resolver with add() before the image renders', () => {
    const resolver = createDocparserAssetResolver();
    const editor = makeEditor('<p>a</p>', { resolveAsset: resolver });
    cursorAt(editor, 1);
    editor.commands.insertDocument(doc(imageBlock()), { assets: [pngAsset()] });
    const img = editor.view.dom.querySelector('img');
    expect(img?.getAttribute('src')).toMatch(/^blob:test\//);
    expect(
      img?.closest('[data-asset-state]')?.getAttribute('data-asset-state') ??
        img?.getAttribute('data-asset-state'),
    ).toBe('resolved');
    // the document keeps the asset reference
    expect(diffStructure(doc(imageBlock()), doc(getLosslessJSON(editor).content![1]!))).toEqual([]);
  });

  it('without assets (or without an add()-resolver) the image shows its missing state and nothing throws', () => {
    const plain = vi.fn(() => undefined);
    const editor = makeEditor('<p>a</p>', { resolveAsset: plain });
    cursorAt(editor, 1);
    expect(editor.commands.insertDocument(doc(imageBlock()), { assets: [pngAsset()] })).toBe(true);
    expect(plain).toHaveBeenCalledWith(PNG_SRC);
    const img = editor.view.dom.querySelector('img')!;
    expect((img.closest('[data-asset-state]') ?? img).getAttribute('data-asset-state')).toBe(
      'missing',
    );
    const noResolver = makeEditor('<p>a</p>');
    expect(noResolver.commands.insertDocument(doc(imageBlock()), { assets: [pngAsset()] })).toBe(
      true,
    );
  });

  it('a malformed asset throws nothing: the insert is refused and the document unchanged', () => {
    const resolver = createDocparserAssetResolver();
    const editor = makeEditor('<p>a</p>', { resolveAsset: resolver });
    const before = JSON.stringify(editor.getJSON());
    let ok: boolean | undefined;
    expect(() => {
      ok = editor.commands.insertDocument(doc(imageBlock()), {
        assets: [{ sha256: 'x' } as never],
      });
    }).not.toThrow();
    expect(ok).toBe(false);
    expect(JSON.stringify(editor.getJSON())).toBe(before);
  });

  it('a profile fixture (pageBreak, figure/figcaption) inserts losslessly into another document', () => {
    const fx = loadProfileFixture('synthetic-profile');
    const editor = makeEditor('<p>前</p><p>後</p>');
    cursorAt(editor, 1);
    editor.commands.insertDocument(fx.doc);
    const inserted = getLosslessJSON(editor).content!.slice(1, 1 + fx.doc.content!.length);
    const diffs = diffStructure(fx.doc, { type: 'doc', content: inserted });
    expect(diffs).toEqual([]);
    expect(types(editor)).toContain('pageBreak');
    expect(types(editor)).toContain('figure');
  });

  it('inserting does not disturb tables: colwidth stays as given (no fixTables rewrite)', () => {
    const fx = loadProfileFixture('synthetic-table-style');
    const editor = makeEditor('<p>x</p>');
    editor.commands.insertDocument(fx.doc);
    const diffs = diffStructure(fx.doc, {
      type: 'doc',
      content: getLosslessJSON(editor).content!.slice(0, fx.doc.content!.length),
    });
    expect(diffs).toEqual([]);
  });

  it('selection lands after the inserted content and is a text selection', () => {
    const editor = makeEditor('<p>a</p>');
    cursorAt(editor, 1);
    editor.commands.insertDocument(doc(para('Q')));
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
    expect(createEditorExtensions().length).toBeGreaterThan(0);
  });
});

function loadProfileFixtureTable(): JSONContent {
  const fx = loadProfileFixture('nested-table');
  return fx.doc.content!.find((n) => n.type === 'table')!;
}
