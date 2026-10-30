// Attribute set ported from docparser examples/editor/web/src/schema.ts (lengthAttrs), names per docparser docs/tiptap.md §1.
import { Extension } from '@tiptap/core';
import type { Attribute, CommandProps, Editor, KeyboardShortcutCommand } from '@tiptap/core';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import {
  convertLength,
  formatLength,
  parseLength,
  readMargin,
  readStyle,
  styleDecl,
} from './cssLength';
import type { MarginSide } from './cssLength';

export interface ParagraphAttributesOptions {
  /** Node types carrying the docparser paragraph attributes. */
  types: string[];
  /**
   * Step added to / removed from `marginLeft` by `indent()` / `outdent()` (pt or px).
   * @default '10pt'
   */
  indentStep: string;
  /** List item node types: inside them `indent()`/`outdent()` sink/lift the item instead. */
  listItemTypes: string[];
  /** Table cell node types: Tab/Shift-Tab are left to the table (cell navigation) inside them. */
  tableCellTypes: string[];
  /** Bind Tab / Shift-Tab to `indent()` / `outdent()` outside lists and tables. */
  keyboardShortcuts: boolean;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphAttributes: {
      /** Increase `marginLeft` of the selected paragraphs/headings by `indentStep` (in a list: sink the item). */
      indent: () => ReturnType;
      /** Decrease `marginLeft` by `indentStep`, removing it at 0 (in a list: lift the item). */
      outdent: () => ReturnType;
      /** Set paragraph/heading `lineHeight` (unitless ratio string like `"1.6"` or a length like `"18pt"`). */
      setLineHeight: (lineHeight: string) => ReturnType;
      /** Remove paragraph/heading `lineHeight`. */
      unsetLineHeight: () => ReturnType;
    };
  }
}

/**
 * attribute name → CSS property (docparser docs/tiptap.md §1). Margins are listed top, right,
 * bottom, left so the declarations reach `style.cssText` in shorthand order.
 */
export const PARAGRAPH_STYLE_ATTRIBUTES = {
  spaceBefore: 'margin-top',
  marginRight: 'margin-right',
  spaceAfter: 'margin-bottom',
  marginLeft: 'margin-left',
  indent: 'text-indent',
  lineHeight: 'line-height',
} as const;

function styleAttribute(property: string, name: string): Attribute {
  const side = property.startsWith('margin-') ? (property.slice(7) as MarginSide) : null;
  return {
    default: null,
    // Raw inline value: pt stays pt, px stays px, ratios stay unitless (no canonicalisation).
    parseHTML: (element) => (side ? readMargin(element, side) : readStyle(element, property)),
    renderHTML: (attributes) => styleDecl(property, attributes[name]),
  };
}

function hasAncestor($pos: ResolvedPos, names: string[]): string | null {
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name;
    if (names.includes(name)) return name;
  }
  return null;
}

type Visit = (node: PMNode, pos: number) => void;

function forEachTextBlock(tr: Transaction, types: string[], skip: string[], visit: Visit): void {
  const { doc, selection } = tr;
  for (const range of selection.ranges) {
    doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
      if (!types.includes(node.type.name)) return true;
      if (!hasAncestor(doc.resolve(pos), skip)) visit(node, pos);
      return false;
    });
  }
}

function setAttrs(
  tr: Transaction,
  types: string[],
  skip: string[],
  compute: (node: PMNode) => Record<string, unknown> | undefined,
): boolean {
  let changed = false;
  forEachTextBlock(tr, types, skip, (node, pos) => {
    const patch = compute(node);
    if (!patch) return;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch });
    changed = true;
  });
  return changed;
}

function shiftMargin(current: unknown, step: string, direction: 1 | -1): string | null | undefined {
  const stepLength = parseLength(step);
  if (!stepLength) return undefined;
  const raw = typeof current === 'string' && current !== '' ? current : '0';
  const cur = parseLength(raw);
  if (!cur) return undefined; // unit we do not step (em, %, …): leave untouched
  const delta = cur.value === 0 ? stepLength : convertLength(stepLength, cur.unit);
  const unit = cur.value === 0 ? stepLength.unit : cur.unit;
  const next = Math.round((cur.value + direction * delta.value) * 100) / 100;
  if (next <= 0) return direction === -1 && cur.value <= 0 ? undefined : null;
  return formatLength({ value: next, unit });
}

function inside(editor: Editor, names: string[]): string | null {
  return hasAncestor(editor.state.selection.$from, names);
}

/**
 * docparser paragraph attributes on paragraph/heading (`indent`, `marginLeft`, `marginRight`,
 * `spaceBefore`, `spaceAfter`, `lineHeight`) plus indent/outdent and paragraph line-height commands.
 * This extension owns `lineHeight`; tiptap's textStyle LineHeight is not part of the kit.
 */
export const ParagraphAttributes = Extension.create<ParagraphAttributesOptions>({
  name: 'paragraphAttributes',

  addOptions() {
    return {
      types: ['paragraph', 'heading'],
      indentStep: '10pt',
      listItemTypes: ['listItem', 'taskItem'],
      tableCellTypes: ['tableCell', 'tableHeader'],
      keyboardShortcuts: true,
    };
  },

  addGlobalAttributes() {
    const attributes: Record<string, Attribute> = {};
    for (const [name, property] of Object.entries(PARAGRAPH_STYLE_ATTRIBUTES)) {
      attributes[name] = styleAttribute(property, name);
    }
    return [{ types: this.options.types, attributes }];
  },

  addCommands() {
    const { types, indentStep, listItemTypes } = this.options;
    const shift =
      (direction: 1 | -1) =>
      () =>
      ({ tr, state, commands }: CommandProps) => {
        const listItem = hasAncestor(state.selection.$from, listItemTypes);
        if (listItem) {
          return direction === 1
            ? commands.sinkListItem(listItem)
            : commands.liftListItem(listItem);
        }
        return setAttrs(tr, types, listItemTypes, (node) => {
          const next = shiftMargin(node.attrs.marginLeft, indentStep, direction);
          return next === undefined ? undefined : { marginLeft: next };
        });
      };
    return {
      indent: shift(1),
      outdent: shift(-1),
      setLineHeight:
        (lineHeight) =>
        ({ tr }) =>
          setAttrs(tr, types, [], () => ({ lineHeight: lineHeight === '' ? null : lineHeight })),
      unsetLineHeight:
        () =>
        ({ tr }) =>
          setAttrs(tr, types, [], (node) =>
            node.attrs.lineHeight == null ? undefined : { lineHeight: null },
          ),
    };
  },

  addKeyboardShortcuts(): Record<string, KeyboardShortcutCommand> {
    if (!this.options.keyboardShortcuts) return {};
    const blocked = () =>
      Boolean(inside(this.editor, [...this.options.listItemTypes, ...this.options.tableCellTypes]));
    return {
      Tab: () => (blocked() ? false : this.editor.commands.indent()),
      'Shift-Tab': () => (blocked() ? false : this.editor.commands.outdent()),
    };
  },
});
