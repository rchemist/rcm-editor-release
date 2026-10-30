import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { ChainedCommands, Editor } from '@tiptap/core';
import { Selection } from '@tiptap/pm/state';
import { CellSelection, cellAround } from '@tiptap/pm/tables';
import type { RcmEditorLabels } from '../labels';
import { COLOR_PALETTE } from '../toolbar/items';

/** Default border written by the border actions. */
export const DEFAULT_CELL_BORDER = '0.5pt solid #000000';

type Chain = ChainedCommands;
type LabelKey = keyof RcmEditorLabels;

interface Action {
  id: string;
  label: LabelKey;
  can: (e: Editor) => boolean;
  run: (c: Chain) => boolean;
}

const act = (id: string, label: LabelKey, can: Action['can'], run: Action['run']): Action => ({
  id,
  label,
  can,
  run,
});

const BORDER_SIDES = ['top', 'right', 'bottom', 'left'] as const;
const ALIGNS = ['top', 'middle', 'bottom'] as const;
const cap = (s: string) => `${s[0]?.toUpperCase()}${s.slice(1)}`;

const DIRECT_BEFORE_GROUPS: Action[] = [
  act(
    'addRowBefore',
    'tmAddRowBefore',
    (e) => e.can().addRowBefore(),
    (c) => c.addRowBefore().run(),
  ),
  act(
    'addRowAfter',
    'tmAddRowAfter',
    (e) => e.can().addRowAfter(),
    (c) => c.addRowAfter().run(),
  ),
  act(
    'addColumnBefore',
    'tmAddColumnBefore',
    (e) => e.can().addColumnBefore(),
    (c) => c.addColumnBefore().run(),
  ),
  act(
    'addColumnAfter',
    'tmAddColumnAfter',
    (e) => e.can().addColumnAfter(),
    (c) => c.addColumnAfter().run(),
  ),
  act(
    'deleteRow',
    'tmDeleteRow',
    (e) => e.can().deleteRow(),
    (c) => c.deleteRow().run(),
  ),
  act(
    'deleteColumn',
    'tmDeleteColumn',
    (e) => e.can().deleteColumn(),
    (c) => c.deleteColumn().run(),
  ),
  act(
    'mergeCells',
    'tmMergeCells',
    (e) => e.can().mergeCells(),
    (c) => c.mergeCells().run(),
  ),
  act(
    'splitCell',
    'tmSplitCell',
    (e) => e.can().splitCell(),
    (c) => c.splitCell().run(),
  ),
  act(
    'toggleHeaderRow',
    'tmToggleHeaderRow',
    (e) => e.can().toggleHeaderRow(),
    (c) => c.toggleHeaderRow().run(),
  ),
  act(
    'toggleHeaderColumn',
    'tmToggleHeaderColumn',
    (e) => e.can().toggleHeaderColumn(),
    (c) => c.toggleHeaderColumn().run(),
  ),
];

const DIRECT_AFTER_GROUPS: Action[] = [
  act(
    'tableWidthFit',
    'tmTableWidthFit',
    (e) => e.can().setTableWidth(null),
    (c) => c.setTableWidth(null).run(),
  ),
  act(
    'tableWidthFull',
    'tmTableWidthFull',
    (e) => e.can().setTableWidth('100%'),
    (c) => c.setTableWidth('100%').run(),
  ),
  act(
    'deleteTable',
    'tmDeleteTable',
    (e) => e.can().deleteTable(),
    (c) => c.deleteTable().run(),
  ),
];

/** The cell element under `target` that belongs to this editor's table, or null. */
function cellOf(editor: Editor, target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const cell = target.closest<HTMLElement>('td, th');
  return cell && editor.view.dom.contains(cell) ? cell : null;
}

function selectionInCell(editor: Editor): boolean {
  const { selection } = editor.state;
  return selection instanceof CellSelection || cellAround(selection.$from) !== null;
}

interface Anchor {
  x: number;
  y: number;
}

export interface TableMenuProps {
  editor: Editor;
  labels: RcmEditorLabels;
}

/**
 * Context menu of table cells: right click in a cell, or Shift+F10 / the ContextMenu key while
 * the selection is in one. Outside tables the browser's own menu stays.
 */
export function TableMenu({ editor, labels }: TableMenuProps) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const close = useCallback(() => setAnchor(null), []);

  useEffect(() => {
    const dom = editor.view.dom;
    const insideSelection = (cell: HTMLElement): boolean => {
      const { selection } = editor.state;
      if (!(selection instanceof CellSelection)) return false;
      const start = editor.view.posAtDOM(cell, 0) - 1;
      let inside = false;
      selection.forEachCell((_node, pos) => {
        if (pos === start) inside = true;
      });
      return inside;
    };
    // A right button press inside the current cell selection must not collapse it.
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 2) return;
      const cell = cellOf(editor, event.target);
      if (cell && insideSelection(cell)) event.stopPropagation();
    };
    const onContextMenu = (event: MouseEvent) => {
      const cell = cellOf(editor, event.target);
      if (!cell) return;
      event.preventDefault();
      if (!insideSelection(cell)) {
        const { doc } = editor.state;
        const $inside = doc.resolve(editor.view.posAtDOM(cell, 0));
        editor.view.dispatch(editor.state.tr.setSelection(Selection.near($inside, 1)));
      }
      setAnchor({ x: event.clientX, y: event.clientY });
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const isMenuKey = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
      if (!isMenuKey || !selectionInCell(editor)) return;
      event.preventDefault();
      const rect = editor.view.coordsAtPos(editor.state.selection.from);
      setAnchor({ x: rect.left, y: rect.bottom });
    };
    dom.addEventListener('mousedown', onMouseDown, true);
    dom.addEventListener('contextmenu', onContextMenu);
    dom.addEventListener('keydown', onKeyDown);
    return () => {
      dom.removeEventListener('mousedown', onMouseDown, true);
      dom.removeEventListener('contextmenu', onContextMenu);
      dom.removeEventListener('keydown', onKeyDown);
    };
  }, [editor]);

  if (!anchor) return null;
  return <Menu editor={editor} labels={labels} anchor={anchor} close={close} />;
}

function Menu({
  editor,
  labels,
  anchor,
  close,
}: TableMenuProps & { anchor: Anchor; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Anchor>(anchor);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Keep the menu inside the viewport.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(4, Math.min(anchor.x, window.innerWidth - rect.width - 4));
    const y = Math.max(4, Math.min(anchor.y, window.innerHeight - rect.height - 4));
    setPlace((p) => (p.x === x && p.y === y ? p : { x, y }));
  }, [anchor, expanded]);

  const items = () =>
    Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    items()[0]?.focus();
  }, []);

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [close]);

  const finish = () => {
    close();
    editor.commands.focus();
  };
  const run = (can: boolean, fn: (c: Chain) => boolean) => {
    if (!can) return;
    fn(editor.chain().focus());
    close();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    let next: number | undefined;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish();
      return;
    }
    if (event.key === 'Tab') {
      close();
      return;
    }
    if (event.key === 'ArrowDown') next = (i + 1) % list.length;
    else if (event.key === 'ArrowUp') next = (i - 1 + list.length) % list.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = list.length - 1;
    else if (event.key === 'ArrowRight') {
      const target = document.activeElement as HTMLElement | null;
      const group = target?.dataset.group;
      if (group && expanded !== group) {
        event.preventDefault();
        setExpanded(group);
      }
      return;
    } else if (event.key === 'ArrowLeft' && expanded) {
      event.preventDefault();
      const parent = list.find(
        (el) => el.dataset.group === expanded && el.hasAttribute('aria-expanded'),
      );
      setExpanded(null);
      parent?.focus();
      return;
    }
    if (next === undefined) return;
    event.preventDefault();
    list[next]?.focus();
  };

  const item = (
    id: string,
    label: string,
    enabled: boolean,
    onActivate: () => void,
    extra: Record<string, unknown> = {},
    content?: ReactNode,
    className = 'rcm-tm-item',
  ) => (
    <button
      key={id}
      type="button"
      role="menuitem"
      className={className}
      data-testid={`rcm-tm-${id}`}
      aria-disabled={enabled ? undefined : true}
      tabIndex={-1}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onActivate}
      {...extra}
    >
      {content ?? label}
    </button>
  );

  const direct = (a: Action) =>
    item(a.id, labels[a.label], a.can(editor), () => run(a.can(editor), a.run));

  const toggleGroup = (id: string) => setExpanded((g) => (g === id ? null : id));
  const groupHead = (id: string, label: string, enabled: boolean) =>
    item(
      id,
      label,
      enabled,
      () => enabled && toggleGroup(id),
      { 'aria-expanded': expanded === id, 'aria-haspopup': 'true', 'data-group': id },
      <>
        <span>{label}</span>
        <span className="rcm-tm-arrow" aria-hidden="true" />
      </>,
    );

  const bgOk = editor.can().setCellBackground(null);
  const borderOk = editor.can().setCellBorder('all', null);
  const alignOk = editor.can().setCellVerticalAlign(null);

  return (
    <div
      ref={ref}
      className="rcm-tm"
      role="menu"
      aria-label={labels.tableMenu}
      data-testid="rcm-table-menu"
      style={{ left: place.x, top: place.y }}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && !ref.current?.contains(next)) close();
      }}
    >
      {DIRECT_BEFORE_GROUPS.map(direct)}
      <div className="rcm-tm-sep" role="separator" />

      {groupHead('cellBackground', labels.tmCellBackground, bgOk)}
      {expanded === 'cellBackground' && (
        <div
          className="rcm-tm-sub rcm-tm-swatches"
          role="group"
          aria-label={labels.tmCellBackground}
        >
          {COLOR_PALETTE.map((hex) =>
            item(
              `cellBackground-${hex.slice(1)}`,
              hex,
              bgOk,
              () => run(bgOk, (c) => c.setCellBackground(hex).run()),
              { 'data-value': hex, 'aria-label': hex, style: { background: hex } },
              '',
              'rcm-tm-swatch',
            ),
          )}
          {item(
            'cellBackground-clear',
            labels.tmClearBackground,
            bgOk,
            () => run(bgOk, (c) => c.setCellBackground(null).run()),
            {},
            undefined,
            'rcm-tm-item rcm-tm-subitem',
          )}
        </div>
      )}

      {groupHead('cellBorder', labels.tmCellBorder, borderOk)}
      {expanded === 'cellBorder' && (
        <div className="rcm-tm-sub" role="group" aria-label={labels.tmCellBorder}>
          {item(
            'cellBorder-all',
            labels.tmBorderAll,
            borderOk,
            () => run(borderOk, (c) => c.setCellBorder('all', DEFAULT_CELL_BORDER).run()),
            {},
            undefined,
            'rcm-tm-item rcm-tm-subitem',
          )}
          {item(
            'cellBorder-none',
            labels.tmBorderNone,
            borderOk,
            () => run(borderOk, (c) => c.setCellBorder('all', null).run()),
            {},
            undefined,
            'rcm-tm-item rcm-tm-subitem',
          )}
          {BORDER_SIDES.map((side) =>
            item(
              `cellBorder-${side}`,
              labels[`tmBorder${cap(side)}` as LabelKey],
              borderOk,
              () => run(borderOk, (c) => c.setCellBorder([side], DEFAULT_CELL_BORDER).run()),
              {},
              undefined,
              'rcm-tm-item rcm-tm-subitem',
            ),
          )}
        </div>
      )}

      {groupHead('verticalAlign', labels.tmVerticalAlign, alignOk)}
      {expanded === 'verticalAlign' && (
        <div className="rcm-tm-sub" role="group" aria-label={labels.tmVerticalAlign}>
          {ALIGNS.map((value) =>
            item(
              `verticalAlign-${value}`,
              labels[`tmAlign${cap(value)}` as LabelKey],
              alignOk,
              () => run(alignOk, (c) => c.setCellVerticalAlign(value).run()),
              {},
              undefined,
              'rcm-tm-item rcm-tm-subitem',
            ),
          )}
        </div>
      )}

      <div className="rcm-tm-sep" role="separator" />
      {DIRECT_AFTER_GROUPS.map(direct)}
    </div>
  );
}
