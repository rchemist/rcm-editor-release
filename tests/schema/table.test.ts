import { afterEach, describe, expect, it } from 'vitest';
import type { Editor, JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { diffDocs, formatDifferences } from '../helpers/json-equal';
import { destroyEditors, loadFixtures, makeEditor } from '../helpers/editor';

afterEach(destroyEditors);

const fixture = (name: string) => {
  const found = loadFixtures().find((f) => f.name === name);
  if (!found) throw new Error(`fixture ${name}`);
  return found.doc as JSONContent;
};

function expectSameDoc(actual: JSONContent, expected: JSONContent) {
  const diffs = diffDocs(expected, actual);
  expect(diffs, formatDifferences(diffs)).toEqual([]);
}

const cell = (attrs: Record<string, unknown> = {}, text = 'x'): JSONContent => ({
  type: 'tableCell',
  attrs: { colspan: 1, rowspan: 1, ...attrs },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const table = (rows: JSONContent[][], attrs: Record<string, unknown> = {}): JSONContent => ({
  type: 'table',
  attrs,
  content: rows.map((r) => ({ type: 'tableRow', content: r })),
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

/** Positions of every cell node in document order. */
function cellPositions(editor: Editor): number[] {
  const out: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') out.push(pos);
    return true;
  });
  return out;
}

function cells(editor: Editor): PMNode[] {
  return cellPositions(editor).map((pos) => editor.state.doc.nodeAt(pos)!);
}

function tableNode(editor: Editor): PMNode {
  let found: PMNode | null = null;
  editor.state.doc.descendants((node) => {
    if (!found && node.type.name === 'table') found = node;
    return !found;
  });
  if (!found) throw new Error('no table');
  return found;
}

function selectCells(editor: Editor, from: number, to: number) {
  const positions = cellPositions(editor);
  editor.view.dispatch(
    editor.state.tr.setSelection(
      CellSelection.create(editor.state.doc, positions[from]!, positions[to]!),
    ),
  );
}

function cursorInCell(editor: Editor, index: number) {
  const pos = cellPositions(editor)[index]!;
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(pos + 1))),
  );
}

/** First `selector` element of serialised HTML (inline styles read back through CSSOM). */
function htmlElement(html: string, selector: string): HTMLElement {
  const el = new DOMParser().parseFromString(html, 'text/html').querySelector(selector);
  if (!(el instanceof HTMLElement)) throw new Error(`no ${selector}`);
  return el;
}

const htmlRoundTrip = (source: JSONContent) => makeEditor(makeEditor(source).getHTML()).getJSON();

describe('table attributes (schema)', () => {
  it('synthetic-table-style survives JSON → HTML → JSON (cell bg/borders/valign/colwidth/spans)', () => {
    const source = fixture('synthetic-table-style');
    expectSameDoc(htmlRoundTrip(source), source);
  });

  it('merged-cell fixtures keep a rectangular table after load and after an edit', () => {
    for (const name of ['synthetic-table-style', 'regulation', 'doc-docx', 'nested-table']) {
      const editor = makeEditor(fixture(name));
      const check = () =>
        editor.state.doc.descendants((node) => {
          if (node.type.name !== 'table') return true;
          // Structural problems only: docparser colwidths may disagree across rows (data, not shape).
          const problems = (TableMap.get(node).problems ?? []).filter(
            (p) => p.type !== 'colwidth mismatch',
          );
          expect(problems, name).toEqual([]);
          return true;
        });
      check();
      cursorInCell(editor, 0);
      expect(editor.commands.setCellBackground('#ffeeee'), name).toBe(true);
      check();
    }
  });

  it('table width/border/align and cell attributes round-trip through HTML', () => {
    const source = doc(
      table(
        [
          [
            cell({
              backgroundColor: '#fff2cc',
              borderTop: '1.13pt solid #c00000',
              borderRight: '0.57pt dashed #0000c0',
              borderBottom: '0.34pt dotted #00a000',
              borderLeft: '1.42pt double #000000',
              verticalAlign: 'middle',
              colwidth: [120],
            }),
            cell({ colwidth: [80] }),
          ],
        ],
        { width: '100%', border: '1px solid #eeeeee', align: 'center' },
      ),
      table([[cell(), cell()]], { width: 480, align: 'right' }),
    );
    expectSameDoc(htmlRoundTrip(source), source);
    const html = makeEditor(source).getHTML();
    const first = htmlElement(html, 'table');
    expect(first.style.width).toBe('100%');
    expect(first.style.border).toBe('1px solid rgb(238, 238, 238)');
    expect(first.getAttribute('data-align')).toBe('center');
    expect(first.style.marginLeft).toBe('auto');
    expect(htmlElement(html, 'table + table').style.width).toBe('480px');
  });

  it('the derived colwidth width does not become a table width on reparse', () => {
    const source = doc(table([[cell({ colwidth: [100] }), cell({ colwidth: [150] })]]));
    const html = makeEditor(source).getHTML();
    expect(html).toContain('width: 250px');
    const json = makeEditor(html).getJSON();
    expect(json.content?.[0]?.attrs?.width ?? null).toBeNull();
    expectSameDoc(json, source);
  });

  it('tables without colwidths keep tiptap min-width rendering', () => {
    const dom = htmlElement(makeEditor(doc(table([[cell(), cell()]]))).getHTML(), 'table');
    expect(dom.style.minWidth).toBe('50px');
    expect(dom.style.width).toBe('');
  });

  it('legacy <table style="width:100%;border:…"> keeps width and border (not only min-width)', () => {
    const editor = makeEditor(
      '<table style="width:100%;border:1px solid #eeeeee;"><tbody><tr>' +
        '<td data-background-color="#FFFF00" style="background-color: #FFFF00">a</td>' +
        '<td>b</td></tr></tbody></table>',
    );
    expect(tableNode(editor).attrs).toMatchObject({ width: '100%', border: '1px solid #eeeeee' });
    expect(cells(editor)[0]!.attrs.backgroundColor).toBe('#ffff00');
    const out = htmlElement(editor.getHTML(), 'table');
    expect(out.style.width).toBe('100%');
    expect(out.style.minWidth).toBe('');
    expect(out.style.border).toBe('1px solid rgb(238, 238, 238)');
    // and in the editing view (TableView)
    const dom = editor.view.dom.querySelector('table')!;
    expect(dom.style.width).toBe('100%');
    expect(dom.style.minWidth).toBe('');
    expect(dom.style.border).toContain('1px solid');
  });

  it('legacy cell HTML: data-background-color, bgcolor, border shorthand, valign, rgb()', () => {
    const editor = makeEditor(
      '<table><tbody><tr>' +
        '<td data-background-color="#00ff00">a</td>' +
        '<td bgcolor="#0000FF" valign="bottom">b</td>' +
        '<td style="border: 1px solid rgb(255, 0, 0); border-top: 2px dashed #00f; vertical-align: middle; background: rgb(1, 2, 3)">c</td>' +
        '</tr></tbody></table>',
    );
    const [a, b, c] = cells(editor).map((n) => n.attrs);
    expect(a!.backgroundColor).toBe('#00ff00');
    expect(b).toMatchObject({ backgroundColor: '#0000ff', verticalAlign: 'bottom' });
    expect(c).toMatchObject({
      backgroundColor: '#010203',
      borderTop: '2px dashed #00f',
      borderRight: '1px solid #ff0000',
      borderBottom: '1px solid #ff0000',
      borderLeft: '1px solid #ff0000',
      verticalAlign: 'middle',
    });
  });

  it('unrepresentable cell styles keep the whole table as rawHtml', () => {
    // `border: none` and `width` on a cell have no schema attribute: dropping them silently is
    // worse than keeping the table verbatim.
    const html =
      '<table><tbody><tr><td style="border: none; width: 10px">d</td></tr></tbody></table>';
    const editor = makeEditor(html);
    expect(editor.getJSON().content?.map((n) => n.type)).toEqual(['rawHtml']);
    expect(editor.getJSON().content?.[0]?.attrs?.html).toBe(html);
  });

  it('table align parses from align= and margin auto; width from width= attribute', () => {
    const attrsOf = (html: string) => tableNode(makeEditor(html)).attrs;
    const body = '<tbody><tr><td>a</td></tr></tbody>';
    expect(attrsOf(`<table align="center" width="600">${body}</table>`)).toMatchObject({
      align: 'center',
      width: 600,
    });
    expect(attrsOf(`<table style="margin: 0 auto">${body}</table>`).align).toBe('center');
    expect(attrsOf(`<table style="margin-left: auto">${body}</table>`).align).toBe('right');
    expect(attrsOf(`<table style="width: 50%">${body}</table>`).width).toBe('50%');
    // An invalid width cannot be represented: kept as rawHtml instead of silently dropped.
    const invalid = makeEditor(`<table style="width: 30em">${body}</table>`);
    expect(invalid.getJSON().content?.map((n) => n.type)).toEqual(['rawHtml']);
  });
});

describe('table commands', () => {
  const grid = () =>
    doc(
      table([
        [cell({}, 'a'), cell({}, 'b')],
        [
          cell({}, 'c'),
          cell({ borderRight: '1px solid #123456', borderBottom: '2px solid #000000' }, 'd'),
        ],
      ]),
    );

  it('setCellBackground("#fff2cc") sets every cell of a CellSelection', () => {
    const editor = makeEditor(grid());
    selectCells(editor, 0, 3);
    expect(editor.commands.setCellBackground('#FFF2CC')).toBe(true);
    expect(cells(editor).map((n) => n.attrs.backgroundColor)).toEqual(Array(4).fill('#fff2cc'));
    expect(htmlElement(editor.getHTML(), 'td').style.backgroundColor).toBe('rgb(255, 242, 204)');
    expect(editor.commands.setCellBackground(null)).toBe(true);
    expect(cells(editor).map((n) => n.attrs.backgroundColor)).toEqual(Array(4).fill(null));
  });

  it('setCellBackground applies to the current cell without a CellSelection', () => {
    const editor = makeEditor(grid());
    cursorInCell(editor, 1);
    editor.commands.setCellBackground('#e2efda');
    expect(cells(editor).map((n) => n.attrs.backgroundColor)).toEqual([
      null,
      '#e2efda',
      null,
      null,
    ]);
  });

  it('table commands outside a table return false and change nothing', () => {
    const editor = makeEditor(doc({ type: 'paragraph', content: [{ type: 'text', text: 'p' }] }));
    const before = editor.getJSON();
    expect(editor.commands.setCellBackground('#ff0000')).toBe(false);
    expect(editor.commands.setCellBorder('all', '1px solid #000000')).toBe(false);
    expect(editor.commands.setTableWidth('100%')).toBe(false);
    expect(editor.getJSON()).toEqual(before);
  });

  it('setCellBorder(sides, "0.5pt solid #000000") sets only those sides', () => {
    const editor = makeEditor(grid());
    cursorInCell(editor, 3);
    expect(editor.commands.setCellBorder(['top', 'left'], '0.5pt solid #000000')).toBe(true);
    expect(cells(editor)[3]!.attrs).toMatchObject({
      borderTop: '0.5pt solid #000000',
      borderLeft: '0.5pt solid #000000',
      borderRight: '1px solid #123456',
      borderBottom: '2px solid #000000',
    });
    expect(cells(editor)[0]!.attrs.borderTop).toBeNull();
    editor.commands.setCellBorder(['right'], null);
    expect(cells(editor)[3]!.attrs.borderRight).toBeNull();
    expect(cells(editor)[3]!.attrs.borderTop).toBe('0.5pt solid #000000');
  });

  it('setCellBorder("all", spec) on a CellSelection sets four sides of every cell', () => {
    const editor = makeEditor(grid());
    selectCells(editor, 0, 3);
    editor.commands.setCellBorder('all', '0.12pt solid #000000');
    for (const n of cells(editor))
      expect(n.attrs).toMatchObject({
        borderTop: '0.12pt solid #000000',
        borderRight: '0.12pt solid #000000',
        borderBottom: '0.12pt solid #000000',
        borderLeft: '0.12pt solid #000000',
      });
  });

  it('setCellVerticalAlign → verticalAlign and HTML vertical-align', () => {
    for (const value of ['top', 'middle', 'bottom'] as const) {
      const editor = makeEditor(grid());
      cursorInCell(editor, 0);
      expect(editor.commands.setCellVerticalAlign(value)).toBe(true);
      expect(cells(editor)[0]!.attrs.verticalAlign).toBe(value);
      expect(htmlElement(editor.getHTML(), 'td').style.verticalAlign).toBe(value);
      editor.commands.setCellVerticalAlign(null);
      expect(cells(editor)[0]!.attrs.verticalAlign).toBeNull();
    }
  });

  it('setTableWidth / setTableAlign persist through getHTML() and reparse', () => {
    const editor = makeEditor(grid());
    cursorInCell(editor, 0);
    expect(editor.commands.setTableWidth('100%')).toBe(true);
    expect(editor.commands.setTableAlign('center')).toBe(true);
    const html = editor.getHTML();
    expect(htmlElement(html, 'table').style.width).toBe('100%');
    const reparsed = makeEditor(html);
    expect(tableNode(reparsed).attrs).toMatchObject({ width: '100%', align: 'center' });
    expect(reparsed.getHTML()).toBe(html);
    // view applies it too
    expect(editor.view.dom.querySelector('table')!.style.width).toBe('100%');
    expect(editor.view.dom.querySelector('table')!.getAttribute('data-align')).toBe('center');

    editor.commands.setTableWidth(640);
    expect(tableNode(editor).attrs.width).toBe(640);
    expect(htmlElement(editor.getHTML(), 'table').style.width).toBe('640px');
    editor.commands.setTableWidth(null);
    editor.commands.setTableAlign(null);
    expect(tableNode(editor).attrs).toMatchObject({ width: null, align: null });
    expect(htmlElement(editor.getHTML(), 'table').style.minWidth).toBe('50px');
  });
});
