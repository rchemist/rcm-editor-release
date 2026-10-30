// Ported from docparser examples/editor/web/src/schema.ts (DocParserEquation), docparser docs/tiptap.md §1.
import { Node } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import type { NodeView } from '@tiptap/pm/view';

/** Label keys of the equation view. */
export const EQUATION_LABEL_KEYS = ['edit', 'editor'] as const;
export type EquationLabelKey = (typeof EQUATION_LABEL_KEYS)[number];
export type EquationLabels = Record<EquationLabelKey, string>;

export const DEFAULT_EQUATION_LABELS: EquationLabels = {
  edit: '수식 스크립트 편집',
  editor: '수식 스크립트',
};

export interface EquationOptions {
  /** Accessible names (merged onto the Korean defaults). */
  labels: Partial<EquationLabels>;
}

/** Event dispatched on an equation's DOM to open its script editor (Enter on a selected equation). */
export const EQUATION_EDIT_EVENT = 'rcm-equation-edit';

/**
 * docparser `equation` inline atom (`script`: HWP equation script, `format: "hwp"`). The script is
 * shown as a chip, not typeset; click or Enter opens an inline script editor (Enter/blur apply,
 * Shift+Enter new line, Escape cancels).
 */
export const Equation = Node.create<EquationOptions>({
  name: 'equation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { labels: {} };
  },

  addAttributes() {
    return {
      format: {
        default: 'hwp',
        parseHTML: (el) => el.getAttribute('data-format') ?? 'hwp',
      },
      script: { default: '', parseHTML: (el) => el.textContent ?? '' },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="equation"]', priority: 100 }];
  },

  renderHTML({ node }) {
    return [
      'span',
      {
        class: 'rcm-equation',
        'data-type': 'equation',
        'data-format': String(node.attrs.format ?? 'hwp'),
      },
      String(node.attrs.script ?? ''),
    ];
  },

  renderText({ node }) {
    return String(node.attrs.script ?? '');
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { selection } = editor.state;
        if (!(selection instanceof NodeSelection) || selection.node.type.name !== this.name)
          return false;
        const dom = editor.view.nodeDOM(selection.from);
        if (!(dom instanceof HTMLElement)) return false;
        dom.dispatchEvent(new CustomEvent(EQUATION_EDIT_EVENT));
        return true;
      },
    };
  },

  addNodeView() {
    const labels = { ...DEFAULT_EQUATION_LABELS, ...this.options.labels };
    return ({ node, editor, getPos }) => {
      let current: PMNode = node;
      const dom = document.createElement('span');
      dom.className = 'rcm-equation';
      dom.contentEditable = 'false';
      dom.setAttribute('data-type', 'equation');
      const chip = document.createElement('span');
      chip.className = 'rcm-equation-script';
      dom.append(chip);

      let popover: HTMLElement | null = null;
      let textarea: HTMLTextAreaElement | null = null;

      const render = () => {
        const script = String(current.attrs.script ?? '');
        dom.setAttribute('data-format', String(current.attrs.format ?? 'hwp'));
        chip.textContent = script;
        dom.title = script;
        dom.setAttribute('role', 'button');
        dom.setAttribute('aria-label', labels.edit);
      };

      const close = () => {
        const open = popover;
        popover = null;
        textarea = null;
        dom.removeAttribute('data-editing');
        open?.remove();
      };

      const commit = (value: string) => {
        close();
        const pos = getPos();
        if (typeof pos !== 'number' || value === current.attrs.script) return;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, script: value }),
        );
      };

      const open = () => {
        if (popover || !editor.isEditable) return;
        popover = document.createElement('span');
        popover.className = 'rcm-equation-popover';
        const input = document.createElement('textarea');
        textarea = input;
        input.className = 'rcm-equation-input';
        input.value = String(current.attrs.script ?? '');
        input.rows = 2;
        input.spellcheck = false;
        input.setAttribute('aria-label', labels.editor);
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
            editor.commands.focus();
          } else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            commit(input.value);
            editor.commands.focus();
          }
        });
        input.addEventListener('blur', () => {
          if (textarea === input) commit(input.value);
        });
        popover.append(input);
        dom.append(popover);
        dom.setAttribute('data-editing', 'true');
        input.focus();
        input.select();
      };

      dom.addEventListener('click', (event) => {
        if (popover?.contains(event.target as globalThis.Node)) return;
        open();
      });
      dom.addEventListener(EQUATION_EDIT_EVENT, open);
      render();

      const view: NodeView = {
        dom,
        update: (updated) => {
          if (updated.type !== current.type) return false;
          current = updated;
          render();
          return true;
        },
        stopEvent: (event) => Boolean(popover?.contains(event.target as globalThis.Node)),
        ignoreMutation: () => true,
        destroy: () => close(),
      };
      return view;
    };
  },
});
