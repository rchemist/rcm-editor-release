// figure/figcaption (editor-only).
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';

export interface FigureOptions {
  HTMLAttributes: Record<string, unknown>;
  /** Image node type wrapped by `toggleImageCaption()`. */
  imageType: string;
}

export interface FigcaptionOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    figure: {
      /**
       * Selected image (NodeSelection) → `figure(image, figcaption)` with the cursor in the empty
       * caption; inside a figure → the bare image again (caption dropped, image selected).
       */
      toggleImageCaption: () => ReturnType;
    };
  }
}

/** `<figcaption>`: inline caption content, only valid inside `figure`. */
export const Figcaption = Node.create<FigcaptionOptions>({
  name: 'figcaption',
  content: 'inline*',
  defining: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  parseHTML() {
    return [{ tag: 'figcaption' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['figcaption', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addKeyboardShortcuts() {
    return {
      // Enter in a caption leaves the figure into a new paragraph below it.
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parent.type.name !== this.name) return false;
        const figureDepth = $from.depth - 1;
        if (figureDepth < 0) return false;
        const after = $from.after(figureDepth);
        return editor
          .chain()
          .insertContentAt(after, { type: 'paragraph' })
          .setTextSelection(after + 1)
          .run();
      },
    };
  },
});

/** `<figure>` holding one image and an optional caption. Registers `figcaption` too. */
export const Figure = Node.create<FigureOptions>({
  name: 'figure',
  group: 'block',
  content: 'image figcaption?',
  isolating: true,
  draggable: true,

  addOptions() {
    return { HTMLAttributes: {}, imageType: 'image' };
  },

  addExtensions() {
    return [Figcaption];
  },

  parseHTML() {
    // Only figures around an image; anything else is left to the other rules (no empty image).
    return [{ tag: 'figure', getAttrs: (el) => (el.querySelector('img[src]') ? null : false) }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['figure', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      toggleImageCaption:
        () =>
        ({ state, tr, dispatch }) => {
          const { selection, schema } = state;
          const figureType = schema.nodes[this.name];
          const captionType = schema.nodes.figcaption;
          if (!figureType || !captionType) return false;

          // Inside a figure (caption cursor, selected image or selected figure): unwrap.
          let figurePos = -1;
          if (selection instanceof NodeSelection && selection.node.type === figureType)
            figurePos = selection.from;
          else {
            const { $from } = selection;
            for (let d = $from.depth; d >= 0; d--) {
              if ($from.node(d).type === figureType) {
                figurePos = d === 0 ? -1 : $from.before(d);
                break;
              }
            }
          }
          if (figurePos >= 0) {
            const figure = tr.doc.nodeAt(figurePos);
            const image = figure?.firstChild;
            if (!figure || !image) return false;
            if (dispatch) {
              tr.replaceWith(figurePos, figurePos + figure.nodeSize, image);
              tr.setSelection(NodeSelection.create(tr.doc, figurePos));
            }
            return true;
          }

          if (!(selection instanceof NodeSelection)) return false;
          const image = selection.node;
          if (image.type.name !== this.options.imageType) return false;
          const figure = figureType.createChecked(null, [image, captionType.create()]);
          const $pos = selection.$from;
          if (!$pos.parent.canReplaceWith($pos.index(), $pos.index() + 1, figureType)) return false;
          if (dispatch) {
            const pos = selection.from;
            tr.replaceWith(pos, pos + image.nodeSize, figure);
            tr.setSelection(TextSelection.create(tr.doc, pos + 1 + image.nodeSize + 1));
          }
          return true;
        },
    };
  },
});
