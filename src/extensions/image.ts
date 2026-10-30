// Node view adapted from @tiptap/extension-image 3.32.1 (MIT) addNodeView.
import { ResizableNodeView, getRenderedAttributes, mergeAttributes } from '@tiptap/core';
import type { Attribute, Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { NodeView } from '@tiptap/pm/view';
import { Image } from '@tiptap/extension-image';
import type { ImageOptions } from '@tiptap/extension-image';
import { parsePxInt, readMargin, readStyle } from './cssLength';

export type ImageAlign = 'left' | 'center' | 'right' | 'inline';

declare module '@tiptap/core' {
  // Own group (not `image`): that key is already declared by `@tiptap/extension-image` and
  // declaration merging requires identical types (TS2717). Command groups flatten into
  // `editor.commands`, so the runtime and call sites are unaffected.
  interface Commands<ReturnType> {
    rcmImage: {
      /**
       * Sets the alignment of the selected image (`"left" | "center" | "right" | "inline"`;
       * `inlineImage` only allows `"left" | "right"`). Any other value (including `null`)
       * removes the attribute. The selection is an image/inlineImage NodeSelection or
       * anything inside a `figure`.
       */
      setImageAlign: (align: ImageAlign | null) => ReturnType;
      /** Sets the alt text of the selected image; an empty string removes the attribute. */
      setImageAlt: (alt: string) => ReturnType;
      /**
       * Sets `width`/`height` of the selected image (rounded to px integers; the caller keeps
       * the aspect ratio). Non-positive or non-finite values are rejected.
       */
      setImageSize: (size: { width: number; height: number }) => ReturnType;
    };
  }
}

/**
 * Maps an image `src` to the URL the editor displays. Called only for `asset:` references
 * (`asset:sha256:<hex>`, docparser §5); the document keeps the original `src`.
 * Return a URL (sync or as a promise), or null/undefined when the asset is not available.
 * A resolver that also has `add(assets)` (e.g. `createDocparserAssetResolver()` from
 * `@rchemist/editor/docparser`) receives the assets of `insertDocument(…, { assets })`.
 */
export type ResolveAsset = (
  src: string,
) => string | null | undefined | Promise<string | null | undefined>;

export interface RcmImageOptions extends ImageOptions {
  /** Display resolver for `asset:` srcs (JSON/HTML keep the original src). */
  resolveAsset: ResolveAsset | null;
}

const ALIGNS = new Set<string>(['left', 'center', 'right', 'inline']);
const BLOCK_ALIGNS: readonly string[] = ['left', 'center', 'right', 'inline'];
const INLINE_ALIGNS: readonly string[] = ['left', 'right'];

const IMAGE_TYPE_NAMES = new Set(['image', 'inlineImage']);

export interface SelectedImage {
  /** Document position of the image node the image commands act on. */
  pos: number;
  /** True for `inlineImage` (align is `left`/`right` only, no caption). */
  inline: boolean;
  /** True when the image lives inside a `figure`. */
  inFigure: boolean;
}

/**
 * The image the image commands and the image bar act on: an image/inlineImage NodeSelection,
 * a selected `figure` (its image), or any selection inside a `figure` (its image).
 */
export function selectedImage(state: EditorState): SelectedImage | null {
  const { selection, doc } = state;
  let pos: number | null = null;
  if (selection instanceof NodeSelection) {
    const node = selection.node;
    if (IMAGE_TYPE_NAMES.has(node.type.name)) pos = selection.from;
    else if (node.type.name === 'figure') {
      const first = node.firstChild;
      if (first && IMAGE_TYPE_NAMES.has(first.type.name)) pos = selection.from + 1;
    }
  }
  if (pos === null) {
    const { $from } = selection;
    for (let d = $from.depth; d >= 0; d--) {
      if ($from.node(d).type.name !== 'figure') continue;
      if (d === 0) break;
      const figurePos = $from.before(d);
      const first = doc.nodeAt(figurePos)?.firstChild;
      if (first && IMAGE_TYPE_NAMES.has(first.type.name)) pos = figurePos + 1;
      break;
    }
  }
  if (pos === null) return null;
  const node = doc.nodeAt(pos);
  if (!node || !IMAGE_TYPE_NAMES.has(node.type.name)) return null;
  const $pos = doc.resolve(pos);
  let inFigure = false;
  for (let d = $pos.depth; d >= 0; d--) {
    if ($pos.node(d).type.name === 'figure') {
      inFigure = true;
      break;
    }
  }
  return { pos, inline: node.type.name === 'inlineImage', inFigure };
}

/** Single-step attribute write on the selected image (marks and selection are kept). */
function setSelectedImageAttrs(
  state: EditorState,
  dispatch: ((tr: EditorState['tr']) => void) | undefined,
  attrs: Record<string, unknown>,
): boolean {
  const target = selectedImage(state);
  if (!target) return false;
  const node = state.doc.nodeAt(target.pos);
  if (!node) return false;
  const next = { ...node.attrs, ...attrs };
  if (dispatch) {
    let changed = false;
    for (const key of Object.keys(attrs)) {
      if (next[key] !== node.attrs[key]) {
        changed = true;
        break;
      }
    }
    if (changed) dispatch(state.tr.setNodeMarkup(target.pos, undefined, next, node.marks));
  }
  return true;
}

/** `src` values handed to `resolveAsset`. */
export function isAssetSrc(src: unknown): src is string {
  return typeof src === 'string' && src.startsWith('asset:');
}

/** Inline style of each `align` value (also used for the HTML output). */
export function imageAlignDecls(align: unknown): [string, string][] {
  switch (align) {
    case 'left':
      return [['float', 'left']];
    case 'right':
      return [['float', 'right']];
    case 'center':
      return [
        ['display', 'block'],
        ['margin-left', 'auto'],
        ['margin-right', 'auto'],
      ];
    case 'inline':
      return [['display', 'inline-block']];
    default:
      return [];
  }
}

/** `align` from `data-align`, the legacy `align` attribute, `float`, or `display:block; margin: auto`. */
export function parseImageAlign(element: HTMLElement): ImageAlign | null {
  const data = element.getAttribute('data-align')?.trim().toLowerCase();
  if (data && ALIGNS.has(data)) return data as ImageAlign;
  const legacy = element.getAttribute('align')?.trim().toLowerCase();
  if (legacy === 'left' || legacy === 'right') return legacy;
  if (legacy === 'center' || legacy === 'middle') return 'center';
  const float = readStyle(element, 'float')?.trim().toLowerCase();
  if (float === 'left' || float === 'right') return float;
  const display = readStyle(element, 'display')?.trim().toLowerCase();
  if (display === 'block') {
    const left = readMargin(element, 'left')?.trim();
    const right = readMargin(element, 'right')?.trim();
    if (left === 'auto' && right === 'auto') return 'center';
  }
  if (display === 'inline-block' || display === 'inline') return 'inline';
  return null;
}

function pxIntAttribute(name: 'width' | 'height'): Attribute {
  return {
    default: null,
    // docparser §1: px integers. `<img width="200">` and `style="width: 200px"` both parse.
    parseHTML: (element) =>
      parsePxInt(element.getAttribute(name)) ?? parsePxInt(readStyle(element, name)),
  };
}

// --- asset re-resolution --------------------------------------------------------------------

const assetListeners = new WeakMap<object, Set<() => void>>();
const wrappedAdd = new WeakSet<object>();

/**
 * Tells every image view using `resolver` to try again the images it showed as missing. Called
 * after `resolver.add(...)` automatically (the editor wraps the resolver's `add` once); call it
 * yourself when assets arrive some other way.
 */
export function refreshAssets(resolver: ResolveAsset | null | undefined): void {
  if (!resolver) return;
  for (const listener of [...(assetListeners.get(resolver) ?? [])]) listener();
}

function subscribeAssets(resolver: ResolveAsset | null, listener: () => void): () => void {
  if (!resolver) return () => {};
  let set = assetListeners.get(resolver);
  if (!set) assetListeners.set(resolver, (set = new Set()));
  set.add(listener);
  const holder = resolver as ResolveAsset & { add?: (...args: unknown[]) => unknown };
  if (typeof holder.add === 'function' && !wrappedAdd.has(resolver)) {
    const original = holder.add;
    try {
      holder.add = function (this: unknown, ...args: unknown[]) {
        const out = original.apply(this, args);
        refreshAssets(resolver);
        return out;
      };
      wrappedAdd.add(resolver);
    } catch {
      // A frozen resolver: re-resolution then needs an explicit refreshAssets().
    }
  }
  return () => {
    set.delete(listener);
  };
}

type AssetState = 'none' | 'pending' | 'resolved' | 'missing';

/** Resolves `src` for display; calls `apply` once with the URL to show and the resolution state. */
function createSourceResolver(getResolver: () => ResolveAsset | null) {
  let token = 0;
  return (src: unknown, apply: (url: string | null, state: AssetState) => void) => {
    const current = ++token;
    const resolver = getResolver();
    if (!isAssetSrc(src) || !resolver) {
      apply(
        typeof src === 'string' && src !== '' ? src : null,
        isAssetSrc(src) ? 'missing' : 'none',
      );
      return;
    }
    let result: ReturnType<ResolveAsset>;
    try {
      result = resolver(src);
    } catch {
      apply(src, 'missing');
      return;
    }
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      apply(null, 'pending');
      (result as Promise<string | null | undefined>).then(
        (url) => {
          if (current === token) apply(url || src, url ? 'resolved' : 'missing');
        },
        () => {
          if (current === token) apply(src, 'missing');
        },
      );
      return;
    }
    const url = result as string | null | undefined;
    apply(url || src, url ? 'resolved' : 'missing');
  };
}

const VIEW_SKIPPED = new Set(['src', 'width', 'height', 'style', 'data-align']);

/**
 * tiptap Image with docparser px-integer `width`/`height`, the editor `align` attribute and
 * `resolveAsset`. The image stays a block node: `align: "inline"` renders `display: inline-block`
 * (consecutive inline images flow on one line), `left`/`right` float, `center` centres the block.
 */
export const RcmImage = Image.extend<RcmImageOptions>({
  addOptions() {
    // `data:` srcs are kept (base64 uploads, pasted HTML): dropping them silently loses content.
    return { ...this.parent!(), allowBase64: true, resolveAsset: null };
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      width: pxIntAttribute('width'),
      height: pxIntAttribute('height'),
      align: {
        default: null,
        parseHTML: parseImageAlign,
        renderHTML: (attributes) => {
          const decls = imageAlignDecls(attributes.align);
          if (!decls.length) return {};
          return {
            'data-align': attributes.align,
            style: decls.map(([p, v]) => `${p}: ${v}`).join('; '),
          };
        },
      },
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setImageAlign:
        (align) =>
        ({ state, dispatch }) => {
          const target = selectedImage(state);
          if (!target) return false;
          const allowed = target.inline ? INLINE_ALIGNS : BLOCK_ALIGNS;
          const value = typeof align === 'string' && allowed.includes(align) ? align : null;
          return setSelectedImageAttrs(state, dispatch, { align: value });
        },
      setImageAlt:
        (alt) =>
        ({ state, dispatch }) =>
          setSelectedImageAttrs(state, dispatch, { alt: alt === '' ? null : alt }),
      setImageSize:
        ({ width, height }) =>
        ({ state, dispatch }) => {
          if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
            return false;
          return setSelectedImageAttrs(state, dispatch, {
            width: Math.round(width),
            height: Math.round(height),
          });
        },
    };
  },

  addNodeView() {
    if (typeof document === 'undefined') return null;
    const resize = this.options.resize && this.options.resize.enabled ? this.options.resize : null;
    const name = this.name;
    const options = this.options;

    return ({ node, getPos, HTMLAttributes, editor }) => {
      const el = document.createElement('img');
      el.draggable = false;
      const resolve = createSourceResolver(() => options.resolveAsset);
      let container: HTMLElement = el;
      let reveal: (() => void) | null = null;

      const setAttributes = (attrs: Record<string, unknown>, previous: Record<string, unknown>) => {
        for (const key of Object.keys(previous))
          if (!VIEW_SKIPPED.has(key) && !(key in attrs)) el.removeAttribute(key);
        for (const [key, value] of Object.entries(attrs)) {
          if (VIEW_SKIPPED.has(key)) continue;
          if (value != null) el.setAttribute(key, String(value));
          else el.removeAttribute(key);
        }
        if (!resize) {
          for (const key of ['width', 'height'] as const) {
            const value = attrs[key];
            if (value != null) el.setAttribute(key, String(value));
            else el.removeAttribute(key);
          }
        }
      };

      let lastSrc: unknown;
      let lastState: AssetState = 'none';
      let retriedFor: unknown;
      const syncSource = (src: unknown, force = false) => {
        if (!force && src === lastSrc) return;
        if (!force) retriedFor = undefined;
        lastSrc = src;
        resolve(src, (url, state) => {
          lastState = state;
          if (url) {
            if (el.getAttribute('src') !== url) el.src = url;
          } else if (el.hasAttribute('src')) el.removeAttribute('src');
          container.setAttribute('data-asset-state', state);
          // Nothing will load: reveal the (hidden until loaded) resizable view now.
          if (!url && state !== 'pending') reveal?.();
        });
      };

      // A resolved display URL that fails to load (expired signed URL): resolve once more.
      el.addEventListener('error', () => {
        if (lastState !== 'resolved' || retriedFor === lastSrc) return;
        retriedFor = lastSrc;
        syncSource(lastSrc, true);
      });
      // Images shown as missing are resolved again when assets are added to the resolver.
      const unsubscribe = subscribeAssets(options.resolveAsset, () => {
        if (lastState === 'missing' && lastSrc !== undefined) syncSource(lastSrc, true);
      });

      const applyAlign = (align: unknown) => {
        const target = container;
        const style = target.style;
        if (align && ALIGNS.has(String(align))) target.setAttribute('data-align', String(align));
        else target.removeAttribute('data-align');
        if (target === el) {
          style.float = '';
          style.display = '';
          style.marginLeft = '';
          style.marginRight = '';
          for (const [p, v] of imageAlignDecls(align)) style.setProperty(p, v);
          return;
        }
        // Resizable container (display:flex from ResizableNodeView); inline nodes stay inline.
        style.float = align === 'left' || align === 'right' ? String(align) : '';
        style.display = align === 'inline' || node.type.isInline ? 'inline-flex' : 'flex';
        style.justifyContent = align === 'center' ? 'center' : '';
      };

      const merged = mergeAttributes(options.HTMLAttributes, HTMLAttributes);
      let previous: Record<string, unknown> = {};
      setAttributes(merged, previous);
      previous = merged;

      const onUpdate = (updated: PMNode): boolean => {
        if (updated.type !== node.type) return false;
        const attributes = (editor as Editor).extensionManager.attributes.filter(
          (a) => a.type === updated.type.name,
        );
        const next = mergeAttributes(
          options.HTMLAttributes,
          getRenderedAttributes(updated, attributes),
        );
        setAttributes(next, previous);
        previous = next;
        syncSource(updated.attrs.src);
        applyAlign(updated.attrs.align);
        return true;
      };

      if (!resize) {
        syncSource(node.attrs.src);
        applyAlign(node.attrs.align);
        const view: NodeView = {
          dom: el,
          update: (updated) => onUpdate(updated),
          destroy: unsubscribe,
        };
        return view;
      }

      const { directions, minWidth, minHeight, alwaysPreserveAspectRatio } = resize;
      const nodeView = new ResizableNodeView({
        element: el,
        editor,
        node,
        getPos,
        onResize: (width, height) => {
          el.style.width = `${width}px`;
          el.style.height = `${height}px`;
        },
        onCommit: (width, height) => {
          const pos = getPos();
          if (pos === undefined) return;
          editor.chain().setNodeSelection(pos).updateAttributes(name, { width, height }).run();
        },
        onUpdate: (updated) => onUpdate(updated),
        options: {
          directions,
          // Contract minimum: tiptap falls back to 8px without explicit values.
          min: { width: minWidth ?? 16, height: minHeight ?? 16 },
          preserveAspectRatio: alwaysPreserveAspectRatio === true,
        },
      });
      container = nodeView.dom as HTMLElement;
      const destroyView = nodeView.destroy.bind(nodeView);
      nodeView.destroy = () => {
        unsubscribe();
        destroyView();
      };

      // Show the view once the image has loaded (correct dimensions), or failed (inspectable).
      const dom = container;
      const show = () => {
        dom.style.visibility = '';
        dom.style.pointerEvents = '';
      };
      reveal = show;
      dom.style.visibility = 'hidden';
      dom.style.pointerEvents = 'none';
      el.onload = show;
      el.onerror = show;
      syncSource(node.attrs.src);
      applyAlign(node.attrs.align);
      if (el.complete && el.naturalWidth > 0) show();
      return nodeView;
    };
  },
});
