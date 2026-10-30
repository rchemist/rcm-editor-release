// framework-free mount: renders <RcmEditor> with react-dom/client (react, react-dom are
// peer dependencies npm installs automatically; the consumer writes no React code).
import { createElement, createRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Editor, JSONContent } from '@tiptap/core';
import { getLosslessHTML, getLosslessJSON } from '../index';
import { RcmEditor, VALUE_LOAD_META } from '../react/RcmEditor';
import type { RcmEditorContent, RcmEditorHandle, RcmEditorProps } from '../react/RcmEditor';

export const VERSION_MARKER = './vanilla';

export type MountEditorOptions = Omit<RcmEditorProps, 'immediatelyRender'>;

export interface MountedEditor {
  /** The tiptap editor (full API). */
  readonly editor: Editor;
  /** Lossless JSON (same as `onChange().json`). */
  getJSON(): JSONContent;
  getHTML(): string;
  /** Replaces the content (also while read-only); does not emit `onChange`. */
  setContent(content: RcmEditorContent): void;
  setReadonly(readonly: boolean): void;
  /** Merges `options` onto the current ones and re-renders (same rules as the React props). */
  update(options: Partial<MountEditorOptions>): void;
  /** Flushes a pending `onChange`, unmounts and destroys the editor. Idempotent. */
  destroy(): void;
}

/** Mounts the editor into `element`. The editor exists when this returns. */
export function mountEditor(element: HTMLElement, options: MountEditorOptions = {}): MountedEditor {
  const root = createRoot(element);
  const handle = createRef<RcmEditorHandle>();
  let current: MountEditorOptions = { ...options };
  let destroyed = false;

  const render = () =>
    flushSync(() =>
      root.render(createElement(RcmEditor, { ...current, immediatelyRender: true, ref: handle })),
    );
  render();

  const editor = (): Editor => {
    if (destroyed) throw new Error('@rchemist/editor: mountEditor() instance was destroyed');
    const e = handle.current?.editor;
    if (!e) throw new Error('@rchemist/editor: editor is not available');
    return e;
  };
  editor();

  return {
    get editor() {
      return editor();
    },
    getJSON: () => getLosslessJSON(editor()),
    getHTML: () => getLosslessHTML(editor()),
    setContent(content) {
      editor()
        .chain()
        .setMeta(VALUE_LOAD_META, true)
        .setContent(content, { emitUpdate: false })
        .run();
    },
    setReadonly(readonly) {
      this.update({ readonly });
    },
    update(next) {
      editor();
      current = { ...current, ...next };
      render();
    },
    destroy() {
      if (destroyed) return;
      const e = handle.current?.editor ?? null;
      root.unmount();
      // useEditor would destroy it on a timer; do it now so nothing outlives destroy().
      if (e && !e.isDestroyed) e.destroy();
      destroyed = true;
    },
  };
}
