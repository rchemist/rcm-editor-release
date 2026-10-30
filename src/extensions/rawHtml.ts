// `rawHtml` block atom: HTML the schema cannot represent is kept verbatim.
//
// Serialization: ProseMirror can only serialize DOM, and a DOM round trip would normalize the
// markup (attribute order, quoting, entities), so `renderHTML` writes a placeholder element
// carrying the verbatim source in one attribute:
//
//   <div data-rcm-raw-html="ESCAPED"></div>
//
// `RawHtml.onBeforeCreate` wraps `editor.getHTML()` so every consumer sees the verbatim markup again
// (`expandRawHtmlPlaceholds` replaces each placeholder with its payload), and loading either
// form (expanded or placeholder) back restores the same `rawHtml` node: the placeholder tag is
// the node's `parseHTML` rule, so an unexpanded `getHTML()` output still reloads losslessly.
// The payload never contains a literal `"` (it is always `&quot;`-escaped, by us when
// generating and by the DOM serializer when writing), so the expansion pattern `"[^"]*"` is
// exact.
import { Node, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { htmlPolicyOf } from '../guard/contentGuard';
import type { HtmlPolicy } from '../html/policy';

export const RAW_HTML = 'rawHtml';

/**
 * Placeholder attribute holding the verbatim source block (escaped). Chosen obscure so author
 * HTML practically never collides; a colliding author element would parse as `rawHtml` (kept,
 * reported) rather than being dropped.
 */
export const RAW_HTML_ATTR = 'data-rcm-raw-html';

export interface RawHtmlOptions {
  HTMLAttributes: Record<string, unknown>;
  /**
   * Preview-mode fallback (the stored markup is untouched): `'trusted'` renders an isolated
   * `<iframe sandbox="allow-scripts" srcdoc>` (no `allow-same-origin`, so the framed document
   * cannot reach the parent); anything else renders in a script-less
   * `<iframe sandbox="allow-same-origin" srcdoc>` (neither inline handlers nor scripts
   * run; the same-origin grant only lets the parent measure the preview height).
   * The guard's policy (`htmlPolicyOf`) wins when the guard is present.
   */
  policy: HtmlPolicy;
}

/** Attribute-escaping for generated placeholder markup (decoded by `getAttribute` on parse). */
export function escapeRawHtmlAttr(html: string): string {
  return html
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Inverse of the DOM serializer's attribute escaping (`&amp;` last so `&amp;lt;` survives). */
export function unescapeRawHtmlAttr(escaped: string): string {
  return escaped
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&');
}

const PLACEHOLDER = new RegExp(`<div ${RAW_HTML_ATTR}="([^"]*)"></div>`, 'g');

/**
 * Replaces every `rawHtml` placeholder in serialized HTML (`editor.getHTML()` /
 * `getHTMLFromFragment()` output) with its verbatim source block. Placeholders with an
 * undecodable payload are left untouched.
 */
export function expandRawHtmlPlaceholders(html: string): string {
  if (!html.includes(RAW_HTML_ATTR)) return html;
  PLACEHOLDER.lastIndex = 0;
  return html.replace(PLACEHOLDER, (_match, payload: string) => {
    try {
      return unescapeRawHtmlAttr(payload);
    } catch {
      return _match;
    }
  });
}

/** Placeholder markup the preservation step splices into HTML before tiptap parses it. */
export function rawHtmlPlaceholder(html: string): string {
  return `<div ${RAW_HTML_ATTR}="${escapeRawHtmlAttr(html)}"></div>`;
}

const MIN_IFRAME_HEIGHT = 120;

// --- parse rule --------------------------------------------------------------------------
//
// The parse rule returns the payload verbatim: every document change passes through the content
// guard's choke point (`appendTransaction`), which cleans `rawHtml` payloads under the editor's
// current policy (with the configured `iframeHosts`) and reports the removals. Sanitizing here
// as well would use the wrong hosts (this extension never sees `iframeHosts`) and could only
// report through a side channel. The script-less preview still bounds any payload.

function renderFrame(host: HTMLElement, html: string, trusted: boolean): () => void {
  host.innerHTML = '';
  const frame = document.createElement('iframe');
  // Trusted: scripts run, same-origin is NOT granted (the framed document cannot reach the
  // parent; the height arrives by message). Anything else: scripts stay off entirely (// inline `on*` handlers must not run in the host page), and the same-origin grant is what
  // lets the parent measure the framed document directly.
  frame.setAttribute('sandbox', trusted ? 'allow-scripts' : 'allow-same-origin');
  frame.setAttribute('srcdoc', html);
  frame.setAttribute('title', 'HTML 미리보기');
  frame.style.width = '100%';
  frame.style.border = '0';
  frame.style.display = 'block';
  frame.style.minHeight = `${MIN_IFRAME_HEIGHT}px`;
  host.appendChild(frame);
  const setHeight = (height: unknown) => {
    if (typeof height === 'number' && Number.isFinite(height) && height > 0)
      frame.style.height = `${Math.min(Math.ceil(height), 5000)}px`;
  };
  if (trusted) {
    // The framed document is same-origin-opaque (no `allow-same-origin`), so the height must
    // come from a message; only messages from this frame are honoured.
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return;
      setHeight((event.data as { __rcmRawHeight?: unknown } | null)?.__rcmRawHeight);
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      frame.remove();
    };
  }
  // Script-less same-origin frame: measure the framed document once it has loaded.
  const onLoad = () => {
    const doc = frame.contentDocument;
    if (!doc) return;
    setHeight(Math.max(doc.documentElement?.scrollHeight ?? 0, doc.body?.scrollHeight ?? 0));
  };
  frame.addEventListener('load', onLoad);
  return () => {
    frame.removeEventListener('load', onLoad);
    frame.remove();
  };
}

/** Sizing script appended to the framed preview (preview-only; never stored). */
export const RAW_FRAME_SIZER =
  "<script>try{parent.postMessage({__rcmRawHeight:document.documentElement.scrollHeight},'*')}catch(e){}</script>";

/**
 * Edit-mode table guide lines inside the preview (preview-only, never stored): the
 * frame does not see the editor's styles, so borderless tables would show no cell edges.
 */
export const RAW_FRAME_TABLE_GUIDES =
  '<style>td,th{outline:1px dashed rgba(128,128,128,.55);outline-offset:-1px}</style>';

function previewHtml(html: string, trusted: boolean, editable: boolean): string {
  const guides = editable ? RAW_FRAME_TABLE_GUIDES : '';
  return trusted ? `${html}${guides}${RAW_FRAME_SIZER}` : `${html}${guides}`;
}

/**
 * Block atom holding a verbatim HTML source block the schema cannot represent
 * (`rawHtml`, attribute `html`). Renders the stored string verbatim in
 * `getHTML()` output (see module docs); the editing view shows a live preview in a sandboxed
 * `srcdoc` iframe (scripts run only under the `trusted` policy, always in an isolated origin).
 * The parse rule keeps payloads verbatim; the content guard's choke point cleans every payload
 * that reaches the document.
 */
export const RawHtml = Node.create<RawHtmlOptions>({
  name: RAW_HTML,
  group: 'block',
  atom: true,
  selectable: true,

  addOptions() {
    return { HTMLAttributes: {}, policy: 'sanitize' };
  },

  addAttributes() {
    return {
      html: {
        default: '',
        // Verbatim: the guard's choke point cleans every payload that reaches the document
        //, under the guard's policy and `iframeHosts` (this extension never sees them).
        parseHTML: (element: HTMLElement) => element.getAttribute(RAW_HTML_ATTR) ?? '',
        renderHTML: (attributes: Record<string, unknown>) => ({
          [RAW_HTML_ATTR]: typeof attributes.html === 'string' ? attributes.html : '',
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: `div[${RAW_HTML_ATTR}]` }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        { [RAW_HTML_ATTR]: node.attrs.html ?? '' },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      '',
    ];
  },

  renderText() {
    return '';
  },

  addNodeView() {
    if (typeof document === 'undefined') return null;
    // The effective policy lives in the guard; the extension option is only the
    // fallback for editors without the guard.
    const fallback = this.options.policy;
    return ({
      node,
      editor,
      view,
    }: {
      node: PMNode;
      editor: Editor;
      view: EditorView;
      getPos: () => number | undefined;
    }) => {
      const trusted = () => (htmlPolicyOf(editor).policy ?? fallback) === 'trusted';
      const dom = document.createElement('div');
      dom.setAttribute('data-rcm-raw-html-preview', '');
      dom.setAttribute('contenteditable', 'false');
      let cleanup: (() => void) | null = null;
      let current: PMNode = node;
      let editable = editor.isEditable;
      const render = (target: PMNode) => {
        current = target;
        editable = editor.isEditable;
        cleanup?.();
        cleanup = null;
        const html = typeof target.attrs.html === 'string' ? target.attrs.html : '';
        // Both policies render a sandboxed `srcdoc` iframe: the preview can never execute in
        // the host page nor overlay the host UI (fixed/absolute content stays in-frame).
        cleanup = renderFrame(dom, previewHtml(html, trusted(), editable), trusted());
      };
      render(node);
      // Editability changes never reach node views (and `setEditable(…, false)` emits nothing);
      // ProseMirror always rewrites the root's `contenteditable`, so watch that for the guides.
      const observer =
        typeof MutationObserver === 'undefined'
          ? null
          : new MutationObserver(() => {
              if (editor.isEditable !== editable) render(current);
            });
      observer?.observe(view.dom, {
        attributes: true,
        attributeFilter: ['contenteditable'],
      });
      return {
        dom,
        update: (updated: PMNode) => {
          if (updated.type !== current.type) return false;
          if (updated.attrs.html !== current.attrs.html) render(updated);
          return true;
        },
        destroy: () => {
          observer?.disconnect();
          cleanup?.();
        },
        ignoreMutation: () => true,
      };
    };
  },

  onBeforeCreate() {
    // Every `getHTML()` consumer (onChange payload, vanilla `getHTML()`, print/listgrid
    // adapters) sees verbatim `rawHtml` markup; without rawHtml nodes this is the identity.
    // In `onBeforeCreate` (not `onCreate`): tiptap emits `create` asynchronously on mount, and
    // headless editors never mount, so `onCreate` would leave a window with raw placeholders.
    const editor = this.editor as Editor;
    const current = editor.getHTML as (() => string) & { __rcmRawWrapped?: boolean };
    if (current.__rcmRawWrapped) return;
    const original = editor.getHTML.bind(editor);
    const wrapped = () => expandRawHtmlPlaceholders(original());
    (wrapped as { __rcmRawWrapped?: boolean }).__rcmRawWrapped = true;
    editor.getHTML = wrapped;
  },
});
