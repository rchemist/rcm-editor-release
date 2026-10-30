// Ported from docparser examples/editor/web/src/schema.ts (DocParserTextBox), docparser docs/tiptap.md §1.
import { Node, mergeAttributes } from '@tiptap/core';
import type { Attribute } from '@tiptap/core';
import { cellAttributes } from './table';
import { parsePxInt, readStyle } from './cssLength';

export interface TextBoxOptions {
  HTMLAttributes: Record<string, unknown>;
}

/** docparser `textBox`: a bordered block (`width` px, `backgroundColor`, `borderTop…Left`). */
export const TextBox = Node.create<TextBoxOptions>({
  name: 'textBox',
  group: 'block',
  content: 'block+',
  defining: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    const { backgroundColor, borderTop, borderRight, borderBottom, borderLeft } = cellAttributes();
    const width: Attribute = {
      default: null,
      parseHTML: (element) => parsePxInt(readStyle(element, 'width')),
      renderHTML: (attributes) =>
        typeof attributes.width === 'number' ? { style: `width: ${attributes.width}px` } : {},
    };
    return {
      width,
      backgroundColor: backgroundColor!,
      borderTop: borderTop!,
      borderRight: borderRight!,
      borderBottom: borderBottom!,
      borderLeft: borderLeft!,
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="text-box"]', priority: 100 }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        { 'data-type': 'text-box', class: 'rcm-text-box' },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      0,
    ];
  },
});
