// pageBreak (editor-only).
import { Node, mergeAttributes } from '@tiptap/core';
import type { TagParseRule } from '@tiptap/pm/model';
import { readStyle } from './cssLength';

export interface PageBreakOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      /** Insert a page break (`break-after: page` in print) at the selection. */
      setPageBreak: () => ReturnType;
    };
  }
}

const BREAK_DECLS: [string, RegExp][] = [
  ['page-break-after', /^always$/i],
  ['break-after', /^page$/i],
  ['page-break-before', /^always$/i],
  ['break-before', /^page$/i],
];

/** A legacy page break: an element without text whose inline style forces a page break. */
export function isLegacyPageBreak(element: HTMLElement): boolean {
  if ((element.textContent ?? '').trim() !== '') return false;
  if (element.querySelector('img, table, iframe, video, object, embed')) return false;
  return BREAK_DECLS.some(([property, value]) => value.test(readStyle(element, property) ?? ''));
}

/** Block atom rendered as `<div data-type="page-break" style="break-after: page">`. */
export const PageBreak = Node.create<PageBreakOptions>({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  parseHTML() {
    const legacy = (tag: string): TagParseRule => ({
      tag,
      priority: 100,
      getAttrs: (el) => (isLegacyPageBreak(el) ? null : false),
    });
    return [
      { tag: 'div[data-type="page-break"]', priority: 100 },
      ...['div', 'p', 'span', 'br', 'hr'].map(legacy),
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'page-break',
        style: 'break-after: page',
      }),
    ];
  },

  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    };
  },
});
