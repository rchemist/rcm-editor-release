// Lossless holders for content the schema cannot represent (content guard).
import { Mark, Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { NodeView } from '@tiptap/pm/view';
import { fillLabel } from '../extensions/labels';

export const UNSUPPORTED_NODE = 'unsupportedNode';
export const UNSUPPORTED_INLINE = 'unsupportedInline';
export const UNSUPPORTED_MARK = 'unsupportedMark';
/** Global node attribute holding attributes the node type does not define. */
export const UNSUPPORTED_ATTRS = 'unsupportedAttrs';

/** Label keys: `block`/`inline` (`{type}` = original node type), `fatal` (guard failure). */
export const UNSUPPORTED_LABEL_KEYS = ['block', 'inline', 'fatal'] as const;
export type UnsupportedLabelKey = (typeof UNSUPPORTED_LABEL_KEYS)[number];
export type UnsupportedLabels = Record<UnsupportedLabelKey, string>;

export const DEFAULT_UNSUPPORTED_LABELS: UnsupportedLabels = {
  block: '지원하지 않는 요소: {type}',
  inline: '{type}',
  fatal: '내용을 안전하게 열 수 없어 원본을 보존한 채 읽기 전용으로 표시합니다',
};

export interface UnsupportedNodeOptions {
  HTMLAttributes: Record<string, unknown>;
  /** Visible text (merged onto the Korean defaults). */
  labels: Partial<UnsupportedLabels>;
}

/** `json` attribute of an unsupported node: the original JSON subtree, kept verbatim. */
export interface UnsupportedNodeAttrs {
  json: unknown;
  /** Set on the single holder that wraps a whole document after a guard failure. */
  fatal?: boolean;
}

/** `json` attribute of an `unsupportedMark`. */
export interface UnsupportedMarkJson {
  /** Unknown/invalid marks with their index in the original `marks` array. */
  marks: { index: number; mark: unknown }[];
  /** Attributes the known mark types do not define, by mark type. */
  attrs: Record<string, Record<string, unknown>>;
  /** Keys of the text node other than `type`/`text`/`marks` (restored onto the text node). */
  keys?: Record<string, unknown>;
}

export function parseJsonAttribute(value: string | null): unknown {
  if (value == null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/** Original type name of the held JSON (`?` when it has none). */
export function unsupportedTypeOf(json: unknown): string {
  return json && typeof json === 'object' && typeof (json as { type?: unknown }).type === 'string'
    ? (json as { type: string }).type
    : '?';
}

function labelFor(node: PMNode, labels: Partial<UnsupportedLabels>, inline: boolean): string {
  const nonEmpty = (v: string | undefined) => (v && v.trim() !== '' ? v : undefined);
  const key: UnsupportedLabelKey = node.attrs.fatal ? 'fatal' : inline ? 'inline' : 'block';
  const template = nonEmpty(labels[key]) ?? DEFAULT_UNSUPPORTED_LABELS[key];
  const type = unsupportedTypeOf(node.attrs.json);
  return nonEmpty(fillLabel(template, { type })) ?? type;
}

function holderAttributes() {
  return {
    json: {
      default: null,
      parseHTML: (el: HTMLElement) => parseJsonAttribute(el.getAttribute('data-json')),
      renderHTML: (attrs: Record<string, unknown>) => ({
        'data-json': JSON.stringify(attrs.json ?? null),
      }),
    },
    fatal: {
      default: false,
      parseHTML: (el: HTMLElement) => el.hasAttribute('data-unsupported-fatal'),
      renderHTML: (attrs: Record<string, unknown>) =>
        attrs.fatal ? { 'data-unsupported-fatal': '' } : {},
    },
  };
}

function holderView(inline: boolean, labels: Partial<UnsupportedLabels>) {
  if (typeof document === 'undefined') return null;
  return ({ node }: { node: PMNode }): NodeView => {
    const dom = document.createElement(inline ? 'span' : 'div');
    const render = (n: PMNode) => {
      const label = labelFor(n, labels, inline);
      dom.className = inline ? 'rcm-unsupported rcm-unsupported-inline' : 'rcm-unsupported';
      dom.setAttribute('data-unsupported-type', unsupportedTypeOf(n.attrs.json));
      if (n.attrs.fatal) dom.setAttribute('data-unsupported-fatal', '');
      else dom.removeAttribute('data-unsupported-fatal');
      dom.setAttribute('role', 'note');
      dom.setAttribute('aria-label', label);
      dom.textContent = label;
    };
    render(node);
    dom.setAttribute('contenteditable', 'false');
    return {
      dom,
      update: (updated) => {
        if (updated.type !== node.type) return false;
        render(updated);
        return true;
      },
      ignoreMutation: () => true,
    };
  };
}

/** Block atom holding a JSON subtree the schema cannot load (rendered as a visible box). */
export const UnsupportedNode = Node.create<UnsupportedNodeOptions>({
  name: UNSUPPORTED_NODE,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { HTMLAttributes: {}, labels: {} };
  },

  addAttributes: holderAttributes,

  parseHTML() {
    return [{ tag: 'div[data-unsupported-type][data-json]', priority: 100 }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        { class: 'rcm-unsupported', 'data-unsupported-type': unsupportedTypeOf(node.attrs.json) },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      labelFor(node, this.options.labels, false),
    ];
  },

  renderText({ node }) {
    return labelFor(node, this.options.labels, false);
  },

  addNodeView() {
    return holderView(false, this.options.labels);
  },
});

/** Inline atom holding an inline JSON node the schema cannot load. */
export const UnsupportedInline = Node.create<UnsupportedNodeOptions>({
  name: UNSUPPORTED_INLINE,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { HTMLAttributes: {}, labels: {} };
  },

  addAttributes: holderAttributes,

  parseHTML() {
    return [{ tag: 'span[data-unsupported-type][data-json]', priority: 100 }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(
        {
          class: 'rcm-unsupported rcm-unsupported-inline',
          'data-unsupported-type': unsupportedTypeOf(node.attrs.json),
        },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      labelFor(node, this.options.labels, true),
    ];
  },

  renderText({ node }) {
    return labelFor(node, this.options.labels, true);
  },

  addNodeView() {
    return holderView(true, this.options.labels);
  },
});

/**
 * Mark carrying marks (and mark attributes) the schema does not know, so the text stays editable
 * and the originals re-emit from `getLosslessJSON()`. Rendered as `<span data-unsupported-marks>`.
 */
export const UnsupportedMark = Mark.create({
  name: UNSUPPORTED_MARK,

  addAttributes() {
    return {
      json: {
        default: null,
        parseHTML: (el: HTMLElement) =>
          parseJsonAttribute(el.getAttribute('data-unsupported-marks')),
        renderHTML: (attrs: Record<string, unknown>) => ({
          'data-unsupported-marks': JSON.stringify(attrs.json ?? null),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-unsupported-marks]', priority: 100 }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', HTMLAttributes, 0];
  },
});
