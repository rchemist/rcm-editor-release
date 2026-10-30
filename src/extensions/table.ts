// Cell attributes ported from docparser examples/editor/web/src/schema.ts (cellAttrs).
import { Extension, mergeAttributes } from '@tiptap/core';
import type { Attribute, CommandProps } from '@tiptap/core';
import type { DOMOutputSpec, Node as PMNode } from '@tiptap/pm/model';
import { CellSelection, cellAround } from '@tiptap/pm/tables';
import type { EditorView } from '@tiptap/pm/view';
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
  TableView,
  createColGroup,
} from '@tiptap/extension-table';
import type { TableKitOptions } from '@tiptap/extension-table';
import {
  normalizeBorder,
  normalizeColor,
  parsePxInt,
  readBackgroundColor,
  readBorder,
  readMargin,
  readStyle,
  safeCssValue,
  styleDecl,
} from './cssLength';
import type { BorderSide } from './cssLength';

export type CellBorderSide = BorderSide;
export type CellVerticalAlign = 'top' | 'middle' | 'bottom';
export type TableAlign = 'left' | 'center' | 'right';
/** px integer or a percentage string such as `"100%"`. */
export type TableWidth = number | `${number}%`;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableAttributes: {
      /** Set (`null`: remove) `backgroundColor` of the selected cells (CellSelection or current cell). */
      setCellBackground: (color: string | null) => ReturnType;
      /** Set (`null`: remove) the given border sides (`"<w> <style> <color>"`) of the selected cells. */
      setCellBorder: (sides: CellBorderSide[] | 'all', spec: string | null) => ReturnType;
      /** Set (`null`: remove) `verticalAlign` of the selected cells. */
      setCellVerticalAlign: (value: CellVerticalAlign | null) => ReturnType;
      /** Set (`null`: remove) the width of the table around the selection. */
      setTableWidth: (width: TableWidth | null) => ReturnType;
      /** Set (`null`: remove) the alignment of the table around the selection. */
      setTableAlign: (align: TableAlign | null) => ReturnType;
    };
  }
}

const SIDES: readonly CellBorderSide[] = ['top', 'right', 'bottom', 'left'];
const BORDER_ATTR: Record<CellBorderSide, string> = {
  top: 'borderTop',
  right: 'borderRight',
  bottom: 'borderBottom',
  left: 'borderLeft',
};
const VERTICAL_ALIGN = new Set(['top', 'middle', 'bottom', 'baseline', 'sub', 'super']);
const TABLE_ALIGN = new Set<string>(['left', 'center', 'right']);

/** Cell attributes (docparser §1), parsed from inline style and legacy HTML attributes. */
export function cellAttributes(): Record<string, Attribute> {
  const border = (side: CellBorderSide): Attribute => ({
    default: null,
    parseHTML: (element) => readBorder(element, side),
    renderHTML: (attributes) => styleDecl(`border-${side}`, attributes[BORDER_ATTR[side]]),
  });
  return {
    backgroundColor: {
      default: null,
      // A legacy editor's table cell wrote `data-background-color`; legacy HTML may carry `bgcolor`.
      parseHTML: (element) =>
        normalizeColor(element.getAttribute('data-background-color')) ??
        readBackgroundColor(element) ??
        normalizeColor(element.getAttribute('bgcolor')),
      renderHTML: (attributes) => styleDecl('background-color', attributes.backgroundColor),
    },
    borderTop: border('top'),
    borderRight: border('right'),
    borderBottom: border('bottom'),
    borderLeft: border('left'),
    verticalAlign: {
      default: null,
      parseHTML: (element) => {
        const raw = (readStyle(element, 'vertical-align') ?? element.getAttribute('valign'))
          ?.trim()
          .toLowerCase();
        return raw && VERTICAL_ALIGN.has(raw) ? raw : null;
      },
      renderHTML: (attributes) => styleDecl('vertical-align', attributes.verticalAlign),
    },
  };
}

/** Table `width` from `style="width: …"` or the legacy `width` attribute (px int or `"<n>%"`). */
function parseTableWidth(element: HTMLElement): TableWidth | null {
  const raw = (readStyle(element, 'width') ?? element.getAttribute('width'))?.trim();
  if (!raw) return null;
  const pct = /^(\d+(?:\.\d+)?)%$/.exec(raw);
  if (pct) return `${Number(pct[1])}%`;
  const px = parsePxInt(raw);
  if (px === null || px <= 0) return null;
  // tiptap renders `width: <sum of colwidths>px` for fully fixed tables; that is derived, not a
  // table attribute, so it must not become `width` on reparse.
  const cols = Array.from(element.querySelectorAll(':scope > colgroup > col')) as HTMLElement[];
  if (cols.length) {
    const widths = cols.map((col) => parsePxInt(readStyle(col, 'width')));
    if (widths.every((w) => w !== null) && widths.reduce<number>((a, w) => a + (w ?? 0), 0) === px)
      return null;
  }
  return px;
}

function parseTableAlign(element: HTMLElement): TableAlign | null {
  const raw = (element.getAttribute('data-align') ?? element.getAttribute('align'))
    ?.trim()
    .toLowerCase();
  if (raw && TABLE_ALIGN.has(raw)) return raw as TableAlign;
  const left = readMargin(element, 'left')?.trim();
  const right = readMargin(element, 'right')?.trim();
  if (left === 'auto' && right === 'auto') return 'center';
  if (left === 'auto') return 'right';
  return null;
}

/** CSS width of the `width` table attribute, or null. */
export function tableWidthCss(width: unknown): string | null {
  if (typeof width === 'number' && Number.isFinite(width) && width > 0) return `${width}px`;
  if (typeof width === 'string' && /^\d+(?:\.\d+)?%$/.test(width)) return width;
  return null;
}

function tableAlignDecls(align: unknown): [string, string][] {
  switch (align) {
    case 'center':
      return [
        ['margin-left', 'auto'],
        ['margin-right', 'auto'],
      ];
    case 'right':
      return [
        ['margin-left', 'auto'],
        ['margin-right', '0'],
      ];
    case 'left':
      return [
        ['margin-left', '0'],
        ['margin-right', 'auto'],
      ];
    default:
      return [];
  }
}

/** TableView that also applies the table `width`/`border`/`align` attributes in the editor. */
export class RcmTableView extends TableView {
  constructor(
    node: PMNode,
    cellMinWidth: number,
    view?: EditorView,
    HTMLAttributes: Record<string, unknown> = {},
  ) {
    super(node, cellMinWidth, view, HTMLAttributes);
    this.applyTableAttributes(node);
  }

  update(node: PMNode): boolean {
    const updated = super.update(node);
    if (updated) this.applyTableAttributes(node);
    return updated;
  }

  private applyTableAttributes(node: PMNode): void {
    const { style } = this.table;
    const width = tableWidthCss(node.attrs.width);
    if (width) {
      style.width = width;
      style.minWidth = '';
    }
    const border = safeCssValue(node.attrs.border);
    style.border = border ?? '';
    style.marginLeft = '';
    style.marginRight = '';
    for (const [property, value] of tableAlignDecls(node.attrs.align))
      style.setProperty(property, value);
    if (node.attrs.align) this.table.setAttribute('data-align', String(node.attrs.align));
    else this.table.removeAttribute('data-align');
  }
}

/** tiptap Table plus `width`, `border`, `align` and the table commands. */
export const RcmTable = Table.extend({
  addOptions() {
    return { ...this.parent!(), View: RcmTableView };
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null, parseHTML: parseTableWidth, rendered: false },
      border: {
        default: null,
        parseHTML: (element) => readBorder(element, null),
        rendered: false,
      },
      align: { default: null, parseHTML: parseTableAlign, rendered: false },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    // Same output as tiptap's Table (colgroup + width/min-width from colwidths) with the table
    // attributes added; an explicit `width` replaces the derived one.
    const { colgroup, tableWidth, tableMinWidth } = createColGroup(node, this.options.cellMinWidth);
    const { style: extraStyle, ...rest } = HTMLAttributes as Record<string, unknown>;
    const decls: string[] = [];
    const width = tableWidthCss(node.attrs.width);
    if (width) decls.push(`width: ${width}`);
    else if (tableWidth) decls.push(`width: ${tableWidth}`);
    else if (tableMinWidth) decls.push(`min-width: ${tableMinWidth}`);
    const border = safeCssValue(node.attrs.border);
    if (border) decls.push(`border: ${border}`);
    for (const [property, value] of tableAlignDecls(node.attrs.align))
      decls.push(`${property}: ${value}`);
    if (typeof extraStyle === 'string' && extraStyle) decls.push(extraStyle);
    const attrs = mergeAttributes(this.options.HTMLAttributes, rest, {
      ...(decls.length ? { style: decls.join('; ') } : {}),
      ...(node.attrs.align ? { 'data-align': node.attrs.align } : {}),
    });
    const table: DOMOutputSpec = colgroup
      ? ['table', attrs, colgroup, ['tbody', 0]]
      : ['table', attrs, ['tbody', 0]];
    return this.options.renderWrapper ? ['div', { class: 'tableWrapper' }, table] : table;
  },

  addCommands() {
    const cellTypes = ['tableCell', 'tableHeader'];
    const patchCells =
      (compute: (node: PMNode) => Record<string, unknown>) =>
      ({ tr, state, dispatch }: CommandProps) => {
        const targets: { node: PMNode; pos: number }[] = [];
        const { selection } = state;
        if (selection instanceof CellSelection) {
          selection.forEachCell((node, pos) => targets.push({ node, pos }));
        } else {
          const $cell = cellAround(selection.$from);
          const node = $cell?.nodeAfter;
          if ($cell && node && cellTypes.includes(node.type.name))
            targets.push({ node, pos: $cell.pos });
        }
        if (!targets.length) return false;
        if (dispatch)
          for (const { node, pos } of targets)
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...compute(node) });
        return true;
      };
    const patchTable =
      (patch: Record<string, unknown>) =>
      ({ tr, state, dispatch }: CommandProps) => {
        const { $from } = state.selection;
        for (let d = $from.depth; d >= 0; d--) {
          const node = $from.node(d);
          if (node.type.name !== this.name) continue;
          if (dispatch) tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, ...patch });
          return true;
        }
        // A NodeSelection on the table itself.
        const selected = state.doc.nodeAt(state.selection.from);
        if (selected?.type.name === this.name) {
          if (dispatch)
            tr.setNodeMarkup(state.selection.from, undefined, { ...selected.attrs, ...patch });
          return true;
        }
        return false;
      };

    return {
      ...this.parent?.(),
      setCellBackground: (color) => patchCells(() => ({ backgroundColor: normalizeColor(color) })),
      setCellBorder: (sides, spec) => {
        const list = sides === 'all' ? SIDES : sides;
        const value = normalizeBorder(spec);
        return patchCells(() => Object.fromEntries(list.map((side) => [BORDER_ATTR[side], value])));
      },
      setCellVerticalAlign: (value) =>
        patchCells(() => ({
          verticalAlign: value && VERTICAL_ALIGN.has(value) ? value : null,
        })),
      setTableWidth: (width) =>
        patchTable({ width: width === null ? null : tableWidthCss(width) ? width : null }),
      setTableAlign: (align) =>
        patchTable({ align: align && TABLE_ALIGN.has(align) ? align : null }),
    };
  },
});

export const RcmTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttributes() };
  },
});

export const RcmTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttributes() };
  },
});

/** Same composition and option shape as tiptap's TableKit, with the docparser/editor table attributes. */
export const RcmTableKit = Extension.create<TableKitOptions>({
  name: 'tableKit',

  addExtensions() {
    const o = this.options;
    const list = [];
    if (o.table !== false) list.push(RcmTable.configure(o.table));
    if (o.tableCell !== false) list.push(RcmTableCell.configure(o.tableCell));
    if (o.tableHeader !== false) list.push(RcmTableHeader.configure(o.tableHeader));
    if (o.tableRow !== false) list.push(TableRow.configure(o.tableRow));
    return list;
  },
});
