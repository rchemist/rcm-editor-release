// HTML output fidelity: what getHTML() writes is what the schema rendered.
import { Extension } from '@tiptap/core';
import { DOMSerializer } from '@tiptap/pm/model';
import type { DOMOutputSpec, Fragment, Mark, Node as PMNode, Schema } from '@tiptap/pm/model';
import { sanitizeStyle } from './cssLength';

/** Style that makes ProseMirror's DOMParser keep the whitespace of the element's text. */
export const PRESERVE_WHITESPACE_STYLE = 'white-space: pre-wrap';

/** Property names of the raw `style` attribute (as written, not as the browser expands them). */
function rawStyleProperties(element: HTMLElement): string[] {
  const style = element.getAttribute('style') ?? '';
  return style
    .split(';')
    .filter((decl) => decl.includes(':'))
    .map((decl) => decl.slice(0, decl.indexOf(':')).trim().toLowerCase());
}

/** Spans whose only inline style is `white-space` (our tab wrapper, Google Docs' `pre-wrap`). */
export function isWhitespaceOnlySpan(element: HTMLElement): boolean {
  if (element.nodeName !== 'SPAN') return false;
  const props = rawStyleProperties(element);
  return props.length > 0 && props.every((p) => p === 'white-space');
}

type SerializeOptions = { document?: Document };
type Rendered = { dom: globalThis.Node; contentDOM?: HTMLElement | null };
type PatchableSerializer = DOMSerializer & {
  serializeFragment(
    fragment: Fragment,
    options?: SerializeOptions,
    target?: HTMLElement | DocumentFragment,
  ): HTMLElement | DocumentFragment;
  serializeNodeInner(node: PMNode, options: SerializeOptions): globalThis.Node;
  serializeMark(mark: Mark, inline: boolean, options?: SerializeOptions): Rendered | null;
  __rcmFidelity?: true;
};

const isAttrs = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  typeof (value as { nodeType?: unknown }).nodeType !== 'number';

/**
 * Re-applies every `style` of `spec` verbatim to the DOM `renderSpec` built from it (minus any
 * declaration that could load or run something, `sanitizeStyle`). ProseMirror
 * writes styles through `style.cssText`, which makes the browser canonicalise them (Chromium drops
 * font-family quotes, colours become `rgb()`), so the HTML would differ per browser and lose
 * byte identity of font stacks.
 */
function restoreStyles(spec: DOMOutputSpec, dom: globalThis.Node | null | undefined): void {
  if (!Array.isArray(spec) || !dom || dom.nodeType !== 1) return;
  const el = dom as HTMLElement;
  let start = 1;
  const attrs: unknown = spec[1];
  if (isAttrs(attrs)) {
    start = 2;
    if (typeof attrs.style === 'string' && attrs.style !== '') {
      const style = sanitizeStyle(attrs.style);
      if (style) el.setAttribute('style', style);
      else el.removeAttribute('style');
    }
  }
  let k = 0;
  for (let i = start; i < spec.length; i++) {
    const child: unknown = spec[i];
    if (child === 0) continue; // content hole: no node of its own
    const node = el.childNodes[k++];
    if (Array.isArray(child)) restoreStyles(child as unknown as DOMOutputSpec, node);
  }
}

let inert: Document | null = null;
function inertDocument(): Document {
  return (inert ??= document.implementation.createHTMLDocument(''));
}

/**
 * Patches `schema`'s cached DOMSerializer (used by `getHTML()` and copy) so that
 * - inline styles are written exactly as the extensions rendered them (no CSS canonicalisation);
 * - a text node containing a tab renders inside `<span style="white-space: pre-wrap">`
 *   (ProseMirror's DOMParser collapses `\t` to a space unless `white-space` is `pre*`);
 * - a fragment serialized without an explicit `document` is built in an inert document, so
 *   images in the output are never fetched.
 * Idempotent; does not touch the editing view.
 */
export function patchHtmlSerializer(schema: Schema): void {
  const serializer = DOMSerializer.fromSchema(schema) as PatchableSerializer;
  if (serializer.__rcmFidelity) return;
  const fragmentInner = serializer.serializeFragment.bind(serializer);
  // tiptap's getHTMLFromFragment serializes into the live document, where an `<img>` starts
  // loading as soon as it has a src (`asset:` srcs fail with ERR_UNKNOWN_URL_SCHEME, real URLs
  // are fetched for nothing). An inert document has no browsing context: nothing loads.
  serializer.serializeFragment = (fragment, options = {}, target) =>
    fragmentInner(
      fragment,
      options.document || target ? options : { ...options, document: inertDocument() },
      target,
    );
  const inner = serializer.serializeNodeInner.bind(serializer);
  const markInner = serializer.serializeMark.bind(serializer);
  serializer.serializeNodeInner = (node, options = {}) => {
    if (node.isText) {
      if (!node.text?.includes('\t')) return inner(node, options);
      const doc = options.document ?? document;
      const span = doc.createElement('span');
      span.setAttribute('style', PRESERVE_WHITESPACE_STYLE);
      span.appendChild(doc.createTextNode(node.text));
      return span;
    }
    const dom = inner(node, options);
    const toDOM = serializer.nodes[node.type.name];
    if (toDOM) restoreStyles(toDOM(node), dom);
    return dom;
  };
  serializer.serializeMark = (mark, inline, options = {}) => {
    const rendered = markInner(mark, inline, options);
    const toDOM = serializer.marks[mark.type.name];
    if (rendered && toDOM) restoreStyles(toDOM(mark, inline), rendered.dom);
    return rendered;
  };
  serializer.__rcmFidelity = true;
}

/**
 * HTML output fidelity for `getHTML()` (and copy): inline styles exactly as rendered — font
 * stacks byte for byte, colours as `#rrggbb`, identical in every browser — and literal tabs kept
 * through HTML (text with `\t` renders in `<span style="white-space: pre-wrap">`; the textStyle
 * span rule ignores such spans). JSON and the editing view are unchanged. Applies to the editor's
 * schema; a standalone `generateHTML()` schema needs `patchHtmlSerializer()`.
 */
export const HtmlFidelity = Extension.create({
  name: 'htmlFidelity',

  onBeforeCreate() {
    patchHtmlSerializer(this.editor.schema);
  },
});
