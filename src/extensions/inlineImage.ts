// inlineImage (editor-only).
import type { Attribute } from '@tiptap/core';
import { RcmImage, parseImageAlign } from './image';
import type { RcmImageOptions } from './image';

export interface InlineImageOptions extends RcmImageOptions {
  /**
   * Parent node types in which an `<img>` parses as `inlineImage` (ProseMirror parse-rule
   * context). Elsewhere (top level, figure, cell without a paragraph) it stays a block `image`.
   */
  inlineContexts: string[];
}

/**
 * Inline atom image (`src`, `alt`, `title`, `width`, `height` — same value formats as `image`):
 * an `<img>` inside a paragraph/heading (legacy `<p>글<img>글</p>`) stays in place instead of
 * splitting the paragraph around a block image. Same node view as `image` (resolveAsset, resize).
 * docparser emits block `image` only; this node comes from HTML input.
 */
export const InlineImage = RcmImage.extend<InlineImageOptions>({
  name: 'inlineImage',

  addOptions() {
    return { ...this.parent!(), inline: true, inlineContexts: ['paragraph', 'heading'] };
  },

  addAttributes() {
    const parent = (this.parent?.() ?? {}) as Record<string, Attribute>;
    return {
      ...parent,
      align: {
        default: null,
        // Inline images float only `left`/`right`; anything else (center, inline) is dropped.
        parseHTML: (element) => {
          const align = parseImageAlign(element);
          return align === 'left' || align === 'right' ? align : null;
        },
        renderHTML: (attributes) => {
          const align = attributes.align;
          if (align !== 'left' && align !== 'right') return {};
          return { 'data-align': align, style: `float: ${align}` };
        },
      },
    };
  },

  parseHTML() {
    const tag = this.options.allowBase64 ? 'img[src]' : 'img[src]:not([src^="data:"])';
    const context = this.options.inlineContexts.map((name) => `${name}/`).join('|');
    return context ? [{ tag, context, priority: 60 }] : [];
  },

  // `setImage` and the markdown input rule belong to the block image.
  addCommands() {
    return {};
  },

  addInputRules() {
    return [];
  },
});
