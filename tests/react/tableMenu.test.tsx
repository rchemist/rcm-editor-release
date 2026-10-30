import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { Editor, JSONContent } from '@tiptap/core';
import { Editor as CoreEditor } from '@tiptap/core';
import { RcmEditor } from '../../src/react';
import type { RcmEditorProps } from '../../src/react';
import { createEditorExtensions } from '../../src/index';
import { resetDevWarnings } from '../../src/react/devWarnings';

// jsdom has no layout: ProseMirror's scroll/coords helpers need these.
const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = emptyRects;
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
}

beforeEach(() => {
  resetDevWarnings();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const TABLE =
  '<table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr><tr><td><p>c</p></td><td><p>d</p></td></tr></tbody></table>';

async function mount(props: RcmEditorProps = {}) {
  let editor: Editor | undefined;
  const utils = render(<RcmEditor defaultValue={TABLE} {...props} onReady={(e) => (editor = e)} />);
  await waitFor(() => expect(editor).toBeDefined());
  const ed = editor as Editor;
  const q = (id: string) => utils.container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const must = (id: string) => {
    const el = q(id);
    if (!el) throw new Error(`missing ${id}`);
    return el;
  };
  const cells = () => Array.from(utils.container.querySelectorAll<HTMLElement>('td, th'));
  const openMenu = (index = 0) => {
    act(
      () => void fireEvent.contextMenu(cells()[index] as HTMLElement, { clientX: 5, clientY: 5 }),
    );
    return must('rcm-table-menu');
  };
  const run = (id: string) => act(() => void fireEvent.click(must(`rcm-tm-${id}`)));
  return { ...utils, editor: ed, q, must, cells, openMenu, run };
}

const tableOf = (editor: Editor): JSONContent =>
  (editor.getJSON().content ?? []).find((n) => n.type === 'table') as JSONContent;
const rowsOf = (editor: Editor) => tableOf(editor)?.content ?? [];
const cellAttrs = (editor: Editor, row: number, col: number) =>
  (rowsOf(editor)[row]?.content?.[col]?.attrs ?? {}) as Record<string, unknown>;

describe('table cell menu', () => {
  it('right click in a cell opens a menu; row/column/header/table actions change the JSON', async () => {
    const t = await mount();
    const menu = t.openMenu(0);
    expect(menu).toHaveAttribute('role', 'menu');
    for (const item of Array.from(menu.querySelectorAll('[data-testid^="rcm-tm-"]'))) {
      expect(item).toHaveAttribute('role', 'menuitem');
    }
    t.run('addRowAfter');
    expect(rowsOf(t.editor)).toHaveLength(3);
    expect(t.q('rcm-table-menu')).toBeNull();

    t.openMenu(0);
    t.run('addColumnBefore');
    expect(rowsOf(t.editor)[0]?.content).toHaveLength(3);

    t.openMenu(0);
    t.run('deleteColumn');
    expect(rowsOf(t.editor)[0]?.content).toHaveLength(2);

    t.openMenu(0);
    t.run('deleteRow');
    expect(rowsOf(t.editor)).toHaveLength(2);

    t.openMenu(0);
    t.run('toggleHeaderRow');
    expect(rowsOf(t.editor)[0]?.content?.[0]?.type).toBe('tableHeader');
    t.openMenu(2);
    t.run('toggleHeaderColumn');
    expect(JSON.stringify(tableOf(t.editor))).toContain('tableHeader');

    t.openMenu(0);
    t.run('addRowBefore');
    expect(rowsOf(t.editor)).toHaveLength(3);
    t.openMenu(0);
    t.run('addColumnAfter');
    expect(rowsOf(t.editor)[0]?.content).toHaveLength(3);

    t.openMenu(0);
    t.run('deleteTable');
    expect(tableOf(t.editor)).toBeUndefined();
  });

  it('merge is disabled for one cell and merges/splits a cell selection', async () => {
    const t = await mount();
    const menu = t.openMenu(0);
    expect(t.must('rcm-tm-mergeCells')).toHaveAttribute('aria-disabled', 'true');
    expect(t.must('rcm-tm-splitCell')).toHaveAttribute('aria-disabled', 'true');
    expect(t.must('rcm-tm-addRowAfter')).not.toHaveAttribute('aria-disabled');
    // a disabled item does nothing
    t.run('mergeCells');
    expect(t.q('rcm-table-menu')).toBe(menu);
    expect(rowsOf(t.editor)[0]?.content).toHaveLength(2);

    act(() => void fireEvent.keyDown(menu, { key: 'Escape' }));
    expect(t.q('rcm-table-menu')).toBeNull();

    // right click inside an existing cell selection keeps it
    const positions: number[] = [];
    t.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell') positions.push(pos);
    });
    act(() => {
      t.editor.commands.setCellSelection({
        anchorCell: positions[0] as number,
        headCell: positions[1] as number,
      });
    });
    t.openMenu(0);
    expect(t.must('rcm-tm-mergeCells')).not.toHaveAttribute('aria-disabled');
    t.run('mergeCells');
    const merged = rowsOf(t.editor)[0]?.content?.[0]?.attrs;
    expect(merged?.colspan).toBeGreaterThan(1);
    t.openMenu(0);
    expect(t.must('rcm-tm-splitCell')).not.toHaveAttribute('aria-disabled');
    t.run('splitCell');
    expect(rowsOf(t.editor)[0]?.content?.[0]?.attrs?.colspan).toBe(1);
  });

  it('cell background, border and vertical align change only their attributes', async () => {
    const t = await mount({
      defaultValue:
        '<table><tbody><tr><td style="background-color: #ff0000"><p>a</p></td><td><p>b</p></td></tr></tbody></table>',
    });
    const before = cellAttrs(t.editor, 0, 1);
    t.openMenu(1);
    t.run('cellBackground');
    expect(t.must('rcm-tm-cellBackground')).toHaveAttribute('aria-expanded', 'true');
    const swatch = t.container.querySelector('[data-testid^="rcm-tm-cellBackground-"][data-value]');
    expect((swatch as HTMLElement).dataset.value).toMatch(/^#[0-9a-f]{6}$/);
    act(() => void fireEvent.click(swatch as HTMLElement));
    expect(cellAttrs(t.editor, 0, 1).backgroundColor).toBe((swatch as HTMLElement).dataset.value);
    expect(cellAttrs(t.editor, 0, 0).backgroundColor).toBe('#ff0000');

    t.openMenu(0);
    t.run('cellBackground');
    t.run('cellBackground-clear');
    expect(cellAttrs(t.editor, 0, 0).backgroundColor).toBeNull();

    t.openMenu(1);
    t.run('cellBorder');
    t.run('cellBorder-all');
    const sides = ['borderTop', 'borderRight', 'borderBottom', 'borderLeft'];
    for (const side of sides) expect(cellAttrs(t.editor, 0, 1)[side]).toBe('0.5pt solid #000000');
    t.openMenu(1);
    t.run('cellBorder');
    t.run('cellBorder-none');
    for (const side of sides) expect(cellAttrs(t.editor, 0, 1)[side]).toBeNull();
    t.openMenu(1);
    t.run('cellBorder');
    t.run('cellBorder-top');
    expect(cellAttrs(t.editor, 0, 1).borderTop).toBe('0.5pt solid #000000');
    expect(cellAttrs(t.editor, 0, 1).borderLeft).toBeNull();

    t.openMenu(1);
    t.run('verticalAlign');
    t.run('verticalAlign-middle');
    expect(cellAttrs(t.editor, 0, 1).verticalAlign).toBe('middle');
    // everything else of the untouched cell is as loaded
    expect({
      ...cellAttrs(t.editor, 0, 1),
      backgroundColor: null,
      borderTop: null,
      verticalAlign: null,
    }).toEqual({
      ...before,
      backgroundColor: null,
      borderTop: null,
      verticalAlign: null,
    });
  });

  it('width actions persist through getHTML() and a reload', async () => {
    const t = await mount();
    t.openMenu(0);
    t.run('tableWidthFull');
    expect(tableOf(t.editor).attrs?.width).toBe('100%');
    const html = t.editor.getHTML();
    expect(html).toContain('width: 100%');
    const reloaded = new CoreEditor({ extensions: createEditorExtensions(), content: html });
    expect((reloaded.getJSON().content?.[0]?.attrs ?? {}).width).toBe('100%');
    expect(reloaded.getHTML()).toBe(html);
    reloaded.destroy();

    t.openMenu(0);
    t.run('tableWidthFit');
    expect(tableOf(t.editor).attrs?.width).toBeNull();
    expect(t.editor.getHTML()).not.toContain('width: 100%');
  });

  it('keyboard: arrows/Home/End move, Esc closes and refocuses the editor, groups expand with ArrowRight', async () => {
    const t = await mount();
    vi.spyOn(t.editor.view, 'coordsAtPos').mockReturnValue({
      left: 3,
      right: 3,
      top: 3,
      bottom: 9,
    });
    t.editor.commands.setTextSelection(3);
    act(() => void fireEvent.keyDown(t.editor.view.dom, { key: 'F10', shiftKey: true }));
    const menu = t.must('rcm-table-menu');
    const items = () => Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    expect(document.activeElement).toBe(items()[0]);
    act(() => void fireEvent.keyDown(menu, { key: 'ArrowDown' }));
    expect(document.activeElement).toBe(items()[1]);
    act(() => void fireEvent.keyDown(menu, { key: 'End' }));
    expect(document.activeElement).toBe(items()[items().length - 1]);
    act(() => void fireEvent.keyDown(menu, { key: 'ArrowDown' }));
    expect(document.activeElement).toBe(items()[0]);
    act(() => void fireEvent.keyDown(menu, { key: 'Home' }));
    expect(document.activeElement).toBe(items()[0]);

    const head = t.must('rcm-tm-verticalAlign');
    head.focus();
    act(() => void fireEvent.keyDown(menu, { key: 'ArrowRight' }));
    expect(head).toHaveAttribute('aria-expanded', 'true');
    act(() => void fireEvent.keyDown(menu, { key: 'ArrowLeft' }));
    expect(head).toHaveAttribute('aria-expanded', 'false');

    act(() => void fireEvent.keyDown(menu, { key: 'Escape' }));
    expect(t.q('rcm-table-menu')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(t.editor.view.dom));

    // ContextMenu key too
    act(() => void fireEvent.keyDown(t.editor.view.dom, { key: 'ContextMenu' }));
    expect(t.q('rcm-table-menu')).not.toBeNull();
  });

  it('works with toolbar={false}; native menu outside tables, with tableMenu={false}, readonly or no table feature', async () => {
    const prompt = vi.spyOn(window, 'prompt');
    const t = await mount({ toolbar: false });
    expect(t.q('rcm-toolbar')).toBeNull();
    t.openMenu(0);
    expect(t.q('rcm-table-menu')).not.toBeNull();
    expect(prompt).not.toHaveBeenCalled();
    cleanup();

    const outside = await mount({ defaultValue: `<p>x</p>${TABLE}` });
    const paragraph = outside.container.querySelector('.ProseMirror > p') as HTMLElement;
    const notPrevented = fireEvent.contextMenu(paragraph);
    expect(notPrevented).toBe(true);
    expect(outside.q('rcm-table-menu')).toBeNull();
    cleanup();

    const off = await mount({ tableMenu: false });
    expect(fireEvent.contextMenu(off.cells()[0] as HTMLElement)).toBe(true);
    expect(off.q('rcm-table-menu')).toBeNull();
    cleanup();

    const ro = await mount({ readonly: true });
    expect(fireEvent.contextMenu(ro.cells()[0] as HTMLElement)).toBe(true);
    expect(ro.q('rcm-table-menu')).toBeNull();
    cleanup();

    const none = await mount({ features: { tableKit: false }, defaultValue: '<p>x</p>' });
    expect(none.q('rcm-tb-table')).toBeNull();
  });
});

describe('table grid picker', () => {
  it('one click shows a 10x10 grid; a cell inserts r rows x c columns without header', async () => {
    const t = await mount({ defaultValue: '<p></p>' });
    expect(t.must('rcm-tb-table')).toHaveAttribute('aria-expanded', 'false');
    act(() => void fireEvent.click(t.must('rcm-tb-table')));
    const cells = Array.from(
      t.container.querySelectorAll<HTMLElement>('[data-testid="rcm-tbo-table-cell"]'),
    );
    expect(cells).toHaveLength(100);
    expect(cells[0]?.dataset).toMatchObject({ row: '1', col: '1' });
    expect(cells[99]?.dataset).toMatchObject({ row: '10', col: '10' });
    expect(t.container.querySelectorAll('.rcm-tb-panel')).toHaveLength(1);
    const pick = cells.find((c) => c.dataset.row === '3' && c.dataset.col === '4') as HTMLElement;
    act(() => void fireEvent.click(pick));
    const rows = rowsOf(t.editor);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.content).toHaveLength(4);
      for (const cell of row.content ?? []) expect(cell.type).toBe('tableCell');
    }
    expect(t.container.querySelector('.rcm-tb-panel')).toBeNull();
  });

  it('arrow keys move over the grid and Esc closes it into the editor', async () => {
    const t = await mount({ defaultValue: '<p></p>' });
    act(() => void fireEvent.click(t.must('rcm-tb-table')));
    const at = (r: number, c: number) =>
      t.container.querySelector<HTMLElement>(
        `[data-testid="rcm-tbo-table-cell"][data-row="${r}"][data-col="${c}"]`,
      ) as HTMLElement;
    expect(document.activeElement).toBe(at(1, 1));
    act(() => void fireEvent.keyDown(at(1, 1), { key: 'ArrowRight' }));
    act(() => void fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' }));
    expect(document.activeElement).toBe(at(2, 2));
    act(() => void fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' }));
    expect(t.container.querySelector('.rcm-tb-panel')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(t.editor.view.dom));
  });
});
