// Ported from docparser examples/editor/web/src/schema.ts (DocParserFootnotes/Footnote/FootnoteReference), docparser docs/tiptap.md §1.
import { Node, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { NodeView } from '@tiptap/pm/view';
import { fillLabel } from './labels';

/** Label keys of the footnote views (`{label}` is replaced by the footnote label). */
export const FOOTNOTE_LABEL_KEYS = ['toFootnote', 'toReference'] as const;
export type FootnoteLabelKey = (typeof FOOTNOTE_LABEL_KEYS)[number];
export type FootnoteLabels = Record<FootnoteLabelKey, string>;

export const DEFAULT_FOOTNOTE_LABELS: FootnoteLabels = {
  toFootnote: '각주 {label}(으)로 이동',
  toReference: '본문의 각주 {label} 위치로 돌아가기',
};

export interface FootnotesOptions {
  HTMLAttributes: Record<string, unknown>;
  /** Accessible names of the jump links (merged onto the Korean defaults). */
  labels: Partial<FootnoteLabels>;
}

interface FootnotePartOptions {
  labels: Partial<FootnoteLabels>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnotes: {
      /** Move the selection into the footnote `id` and scroll it into view. */
      goToFootnote: (id: string) => ReturnType;
      /** Select the first `footnoteReference` to `id` and scroll it into view. */
      goToFootnoteReference: (id: string) => ReturnType;
    };
  }
}

function labelsOf(options: { labels?: Partial<FootnoteLabels> }): FootnoteLabels {
  return { ...DEFAULT_FOOTNOTE_LABELS, ...options.labels };
}

function findNode(doc: PMNode, type: string, id: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.type.name === type && node.attrs.id === id) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

function scrollToNode(editor: Editor, pos: number): void {
  const dom = editor.view.nodeDOM(pos);
  if (dom instanceof HTMLElement && typeof dom.scrollIntoView === 'function')
    dom.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function setData(el: HTMLElement, node: PMNode, type: string): void {
  el.setAttribute('data-type', type);
  for (const key of ['id', 'label'] as const) {
    const value = node.attrs[key];
    if (value != null) el.setAttribute(`data-${key}`, String(value));
    else el.removeAttribute(`data-${key}`);
  }
}

function jumpLink(className: string, onActivate: () => void): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = className;
  link.href = '#';
  link.contentEditable = 'false';
  link.addEventListener('click', (event) => {
    event.preventDefault();
    onActivate();
  });
  return link;
}

/** Inline atom `footnoteReference` (`id`, `label`): superscript number linking to its footnote. */
export const FootnoteReference = Node.create<FootnotePartOptions>({
  name: 'footnoteReference',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { labels: {} };
  },

  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-id') },
      label: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-label') ?? (el.textContent || null),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'sup[data-type="footnote-reference"]', priority: 100 }];
  },

  renderHTML({ node }) {
    return [
      'sup',
      {
        class: 'rcm-footnote-ref',
        'data-type': 'footnote-reference',
        ...(node.attrs.id != null ? { 'data-id': node.attrs.id } : {}),
        ...(node.attrs.label != null ? { 'data-label': node.attrs.label } : {}),
      },
      String(node.attrs.label ?? ''),
    ];
  },

  renderText({ node }) {
    return String(node.attrs.label ?? '');
  },

  addNodeView() {
    const labels = labelsOf(this.options);
    return ({ node, editor }) => {
      let current = node;
      const dom = document.createElement('sup');
      dom.className = 'rcm-footnote-ref';
      dom.contentEditable = 'false';
      const link = jumpLink('rcm-footnote-ref-link', () => {
        const id = current.attrs.id;
        if (id != null) editor.commands.goToFootnote(String(id));
      });
      dom.append(link);
      const render = () => {
        setData(dom, current, 'footnote-reference');
        const label = String(current.attrs.label ?? '');
        link.textContent = label;
        link.setAttribute('aria-label', fillLabel(labels.toFootnote, { label }));
      };
      render();
      const view: NodeView = {
        dom,
        update: (updated) => {
          if (updated.type !== current.type) return false;
          current = updated;
          render();
          return true;
        },
        stopEvent: (event) =>
          (event.type === 'click' || event.type === 'mousedown') &&
          link.contains(event.target as globalThis.Node),
        ignoreMutation: () => true,
      };
      return view;
    };
  },
});

/** Block `footnote` (`id`, `label`, content `block+`) with a back link to its reference. */
export const Footnote = Node.create<FootnotePartOptions>({
  name: 'footnote',
  content: 'block+',
  defining: true,

  addOptions() {
    return { labels: {} };
  },

  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-id') },
      label: { default: null, parseHTML: (el) => el.getAttribute('data-label') },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="footnote"]',
        priority: 100,
        contentElement: (el: HTMLElement) =>
          (el.querySelector(':scope > .rcm-footnote-body') as HTMLElement | null) ?? el,
      },
    ];
  },

  renderHTML({ node }) {
    return [
      'div',
      {
        class: 'rcm-footnote',
        'data-type': 'footnote',
        ...(node.attrs.id != null ? { 'data-id': node.attrs.id } : {}),
        ...(node.attrs.label != null ? { 'data-label': node.attrs.label } : {}),
      },
      ['span', { class: 'rcm-footnote-label' }, String(node.attrs.label ?? '')],
      ['div', { class: 'rcm-footnote-body' }, 0],
    ];
  },

  addNodeView() {
    const labels = labelsOf(this.options);
    return ({ node, editor }) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'rcm-footnote';
      const back = jumpLink('rcm-footnote-backlink', () => {
        const id = current.attrs.id;
        if (id != null) editor.commands.goToFootnoteReference(String(id));
      });
      const body = document.createElement('div');
      body.className = 'rcm-footnote-body';
      dom.append(back, body);
      const render = () => {
        setData(dom, current, 'footnote');
        const label = String(current.attrs.label ?? '');
        back.textContent = label;
        back.setAttribute('aria-label', fillLabel(labels.toReference, { label }));
      };
      render();
      const view: NodeView = {
        dom,
        contentDOM: body,
        update: (updated) => {
          if (updated.type !== current.type) return false;
          current = updated;
          render();
          return true;
        },
        stopEvent: (event) =>
          (event.type === 'click' || event.type === 'mousedown') &&
          back.contains(event.target as globalThis.Node),
        ignoreMutation: (mutation) =>
          mutation.type !== 'selection' && !body.contains(mutation.target),
      };
      return view;
    };
  },
});

/** Block `footnotes` (content `footnote+`): the trailing notes section. Registers footnote and footnoteReference. */
export const Footnotes = Node.create<FootnotesOptions>({
  name: 'footnotes',
  group: 'block',
  content: 'footnote+',
  isolating: true,

  addOptions() {
    return { HTMLAttributes: {}, labels: {} };
  },

  addExtensions() {
    const labels = this.options.labels;
    return [Footnote.configure({ labels }), FootnoteReference.configure({ labels })];
  },

  parseHTML() {
    return [{ tag: 'section[data-type="footnotes"]', priority: 100 }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'section',
      mergeAttributes(
        { class: 'rcm-footnotes', 'data-type': 'footnotes' },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      0,
    ];
  },

  addCommands() {
    return {
      goToFootnote:
        (id) =>
        ({ tr, dispatch, editor }) => {
          const pos = findNode(tr.doc, 'footnote', id);
          if (pos < 0) return false;
          if (dispatch) {
            tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
            scrollToNode(editor, pos);
          }
          return true;
        },
      goToFootnoteReference:
        (id) =>
        ({ tr, dispatch, editor }) => {
          const pos = findNode(tr.doc, 'footnoteReference', id);
          if (pos < 0) return false;
          if (dispatch) {
            tr.setSelection(NodeSelection.create(tr.doc, pos));
            scrollToNode(editor, pos);
          }
          return true;
        },
    };
  },
});
