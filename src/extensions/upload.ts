// Upload pipeline: paste / drop / command → uploader → image (or link) inserted at the
// placeholder's mapped position. Placeholders are decorations, never document nodes.
import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { base64Uploader } from '../upload/uploaders';
import { normalizeUploadResult } from '../upload/uploaders';
import { RcmUploadError } from '../upload/types';
import type { RcmUploadResult, RcmUploader, UploadErrorHandler } from '../upload/types';

/** Texts of the placeholder / error widgets (the React layer fills them from its labels). */
export interface UploadLabels {
  uploading: string;
  failed: string;
  retry: string;
  dismiss: string;
}

export const DEFAULT_UPLOAD_LABELS: UploadLabels = {
  uploading: '업로드 중',
  failed: '업로드 실패',
  retry: '다시 시도',
  dismiss: '닫기',
};

export interface UploadHandlers {
  /** Image uploader (default `base64Uploader()`). */
  uploadImage?: RcmUploader | null;
  /** Uploader of non-image files; without it such files are ignored. */
  uploadFile?: RcmUploader | null;
  onUploadError?: UploadErrorHandler | null;
  labels?: Partial<UploadLabels>;
}

export interface UploadOptions extends UploadHandlers {
  /**
   * Read at every use; defined fields override the static options above. The React component
   * passes a getter so the latest props are always used.
   */
  handlers: (() => UploadHandlers) | null;
}

export interface UploadFilesOptions {
  /** Document position of the placeholder (default: end of the selection). */
  at?: number;
}

declare module '@tiptap/core' {
  interface Storage {
    /** Upload pipeline state: `whenSettled()` resolves when every started upload has finished. */
    upload: UploadStorage;
  }

  interface Commands<ReturnType> {
    upload: {
      /**
       * Runs files through the upload pipeline: each gets a placeholder at `at`, then the
       * uploader's result is inserted there (images as `image`, other files as a link with the
       * file name when `uploadFile` exists). Returns false when nothing was accepted (no files
       * the pipeline handles, or the editor is not editable). Failures leave the document
       * unchanged and show an error placeholder.
       */
      uploadFiles: (files: readonly File[] | FileList, options?: UploadFilesOptions) => ReturnType;
    };
  }
}

type Status = 'uploading' | 'error';

interface Entry {
  id: number;
  file: File;
  kind: 'image' | 'file';
  status: Status;
  progress: number;
  error: RcmUploadError | null;
  controller: AbortController;
  el: HTMLElement | null;
}

type Action =
  | { type: 'add'; id: number; pos: number }
  | { type: 'refresh'; id: number }
  | { type: 'remove'; id: number };

export interface UploadStorage {
  entries: Map<number, Entry>;
  nextId: number;
  pending: Set<Promise<void>>;
  /** Resolves when every started upload has finished (success, failure or dismissal). */
  whenSettled: () => Promise<void>;
  /** Shared by the command and the plugin (set in `addCommands`). */
  api: {
    widget: (entry: Entry) => HTMLElement;
    handlers: () => Required<UploadHandlers>;
  } | null;
}

export const UPLOAD_PLUGIN_KEY = new PluginKey<DecorationSet>('rcmUpload');

const isImageFile = (file: File) => (file.type || '').toLowerCase().startsWith('image/');

function toUploadError(error: unknown): RcmUploadError {
  if (error instanceof RcmUploadError) return error;
  if (error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError')
    return new RcmUploadError('abort', 'Upload aborted', { cause: error });
  return new RcmUploadError('other', error instanceof Error ? error.message : 'Upload failed', {
    cause: error,
  });
}

function findPos(state: EditorState, id: number): number | null {
  const set = UPLOAD_PLUGIN_KEY.getState(state);
  const found = set?.find(undefined, undefined, (spec) => (spec as { id?: number }).id === id);
  return found && found.length > 0 ? found[0]!.from : null;
}

/**
 * Inserts at `pos` without replacing anything: a block goes before / after the textblock when `pos`
 * is its start / end (this keeps the placeholders of sibling uploads alive) or splits the textblock; inline
 * content at a block boundary gets its own paragraph.
 */
function insertResult(tr: Transaction, pos: number, node: PMNode): void {
  const $pos = tr.doc.resolve(pos);
  if (node.isInline) {
    if ($pos.parent.inlineContent) {
      tr.insert(pos, node);
    } else {
      const paragraph = tr.doc.type.schema.nodes.paragraph;
      tr.insert(pos, paragraph ? paragraph.create(null, node) : node);
    }
    return;
  }
  if ($pos.parent.isTextblock && $pos.depth > 0) {
    // Start / end of a textblock (or an empty one): beside it, never splitting off empty paragraphs.
    if ($pos.parentOffset === 0) {
      tr.insert($pos.before(), node);
      return;
    }
    if ($pos.parentOffset === $pos.parent.content.size) {
      tr.insert($pos.after(), node);
      return;
    }
  }
  tr.replaceWith(pos, pos, node);
}

function button(
  className: string,
  testId: string,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `rcm-upload-btn ${className}`;
  el.setAttribute('data-testid', testId);
  el.setAttribute('aria-label', label);
  el.title = label;
  el.textContent = className.includes('retry') ? '↻' : '×';
  el.addEventListener('mousedown', (event) => event.preventDefault());
  el.addEventListener('click', (event) => {
    event.preventDefault();
    onClick();
  });
  return el;
}

export const Upload = Extension.create<UploadOptions, UploadStorage>({
  name: 'upload',

  addOptions() {
    return { handlers: null };
  },

  addStorage() {
    const storage: UploadStorage = {
      entries: new Map(),
      nextId: 1,
      pending: new Set(),
      api: null,
      whenSettled: async () => {
        while (storage.pending.size > 0) await Promise.all([...storage.pending]);
      },
    };
    return storage;
  },

  onDestroy() {
    for (const entry of this.storage.entries.values()) entry.controller.abort();
    this.storage.entries.clear();
  },

  addCommands() {
    const storage = this.storage;
    const getOptions = () => this.options;

    const current = (): Required<UploadHandlers> => {
      const live = getOptions().handlers?.() ?? {};
      const pick = <K extends keyof UploadHandlers>(key: K): UploadHandlers[K] =>
        live[key] !== undefined ? live[key] : getOptions()[key];
      return {
        uploadImage: pick('uploadImage') ?? null,
        uploadFile: pick('uploadFile') ?? null,
        onUploadError: pick('onUploadError') ?? null,
        labels: { ...DEFAULT_UPLOAD_LABELS, ...getOptions().labels, ...live.labels },
      };
    };
    let fallbackImage: RcmUploader | null = null;
    const imageUploader = (h: Required<UploadHandlers>): RcmUploader =>
      h.uploadImage ?? (fallbackImage ??= base64Uploader());

    const dispatchActions = (editor: Editor, actions: Action[]) => {
      if (editor.isDestroyed) return;
      editor.view.dispatch(editor.state.tr.setMeta(UPLOAD_PLUGIN_KEY, actions));
    };

    const removeEntry = (editor: Editor, entry: Entry) => {
      if (storage.entries.get(entry.id) !== entry) return;
      storage.entries.delete(entry.id);
      entry.controller.abort();
      dispatchActions(editor, [{ type: 'remove', id: entry.id }]);
    };

    const fail = (editor: Editor, entry: Entry, error: RcmUploadError) => {
      if (storage.entries.get(entry.id) !== entry || editor.isDestroyed) return;
      entry.status = 'error';
      entry.error = error;
      dispatchActions(editor, [{ type: 'refresh', id: entry.id }]);
      try {
        current().onUploadError?.(error, entry.file);
      } catch {
        // A throwing consumer callback must not break the pipeline.
      }
    };

    const complete = (editor: Editor, entry: Entry, result: RcmUploadResult) => {
      const pos = findPos(editor.state, entry.id);
      if (pos === null) {
        // The placeholder's surroundings were deleted (document replaced): nothing to insert.
        storage.entries.delete(entry.id);
        return;
      }
      const { schema } = editor;
      let node: PMNode;
      if (entry.kind === 'image') {
        if (!schema.nodes.image) {
          fail(editor, entry, new RcmUploadError('other', 'The image node is not available'));
          return;
        }
        node = schema.nodes.image.create({ src: result.src });
      } else {
        if (!schema.marks.link) {
          fail(editor, entry, new RcmUploadError('other', 'The link mark is not available'));
          return;
        }
        node = schema.text(result.name || entry.file.name, [
          schema.marks.link.create({ href: result.src }),
        ]);
      }
      const before = editor.state.doc;
      editor
        .chain()
        .command(({ tr }) => {
          insertResult(tr, pos, node);
          return true;
        })
        .setMeta(UPLOAD_PLUGIN_KEY, [{ type: 'remove', id: entry.id } satisfies Action])
        .run();
      if (editor.state.doc.eq(before)) {
        // Refused (read-only lock, schema): keep the document, show the failure.
        fail(editor, entry, new RcmUploadError('other', 'The result could not be inserted'));
        return;
      }
      storage.entries.delete(entry.id);
      // A filtered transaction would have kept the decoration; make sure it is gone.
      if (findPos(editor.state, entry.id) !== null)
        dispatchActions(editor, [{ type: 'remove', id: entry.id }]);
    };

    const run = (editor: Editor, entry: Entry) => {
      const { controller } = entry;
      const task = (async () => {
        await Promise.resolve();
        const handlers = current();
        const uploader = entry.kind === 'image' ? imageUploader(handlers) : handlers.uploadFile;
        let result: RcmUploadResult;
        try {
          if (!uploader) throw new RcmUploadError('other', 'No uploader is configured');
          const raw = await uploader(entry.file, {
            signal: controller.signal,
            onProgress: (fraction) => {
              if (storage.entries.get(entry.id) !== entry || controller.signal.aborted) return;
              const value = Math.min(1, Math.max(0, Number(fraction) || 0));
              if (value <= entry.progress) return;
              entry.progress = value;
              entry.el?.setAttribute('data-progress', String(value));
              const bar = entry.el?.querySelector<HTMLElement>('.rcm-upload-bar');
              if (bar) bar.style.width = `${Math.round(value * 100)}%`;
            },
          });
          result = normalizeUploadResult(raw);
        } catch (error) {
          if (storage.entries.get(entry.id) !== entry || controller.signal.aborted) return;
          fail(editor, entry, toUploadError(error));
          return;
        }
        if (storage.entries.get(entry.id) !== entry || controller.signal.aborted) return;
        if (editor.isDestroyed) return;
        complete(editor, entry, result);
      })();
      storage.pending.add(task);
      void task.finally(() => storage.pending.delete(task));
    };

    const retry = (editor: Editor, entry: Entry) => {
      if (storage.entries.get(entry.id) !== entry || entry.status !== 'error') return;
      entry.status = 'uploading';
      entry.progress = 0;
      entry.error = null;
      entry.controller = new AbortController();
      dispatchActions(editor, [{ type: 'refresh', id: entry.id }]);
      run(editor, entry);
    };

    const widget = (entry: Entry): HTMLElement => {
      const labels = current().labels;
      const root = document.createElement('span');
      root.className = 'rcm-upload-widget';
      root.setAttribute('contenteditable', 'false');
      const name = document.createElement('span');
      name.className = 'rcm-upload-name';
      name.textContent = entry.file.name;
      if (entry.status === 'uploading') {
        root.classList.add('rcm-upload-widget--busy');
        root.setAttribute('data-testid', 'rcm-upload-placeholder');
        root.setAttribute('role', 'status');
        root.setAttribute('aria-busy', 'true');
        root.setAttribute('aria-label', labels.uploading ?? DEFAULT_UPLOAD_LABELS.uploading);
        root.setAttribute('data-progress', String(entry.progress));
        const track = document.createElement('span');
        track.className = 'rcm-upload-track';
        const bar = document.createElement('span');
        bar.className = 'rcm-upload-bar';
        bar.style.width = `${Math.round(entry.progress * 100)}%`;
        track.append(bar);
        root.append(name, track);
      } else {
        root.classList.add('rcm-upload-widget--error');
        root.setAttribute('data-testid', 'rcm-upload-error');
        root.setAttribute('role', 'alert');
        root.setAttribute('aria-label', labels.failed ?? DEFAULT_UPLOAD_LABELS.failed);
        root.setAttribute('data-error-code', entry.error?.code ?? 'other');
        const message = document.createElement('span');
        message.className = 'rcm-upload-message';
        message.textContent = labels.failed ?? DEFAULT_UPLOAD_LABELS.failed;
        root.append(name, message);
        root.append(
          button('rcm-upload-retry', 'rcm-upload-retry', labels.retry ?? '', () =>
            retry(editorRef, entry),
          ),
        );
      }
      root.append(
        button('rcm-upload-dismiss', 'rcm-upload-dismiss', labels.dismiss ?? '', () =>
          removeEntry(editorRef, entry),
        ),
      );
      entry.el = root;
      return root;
    };

    storage.api = { widget, handlers: current };
    const editorRef = this.editor;

    return {
      uploadFiles:
        (files, options) =>
        ({ editor, tr, state, dispatch }) => {
          if (!editor.isEditable) return false;
          const handlers = current();
          const list = Array.from(files).filter(
            (file) => isImageFile(file) || handlers.uploadFile !== null,
          );
          if (list.length === 0) return false;
          if (!dispatch) return true;
          const size = tr.doc.content.size;
          const at = Math.max(0, Math.min(options?.at ?? state.selection.to, size));
          const actions: Action[] = [];
          const started: Entry[] = [];
          for (const file of list) {
            const entry: Entry = {
              id: storage.nextId++,
              file,
              kind: isImageFile(file) ? 'image' : 'file',
              status: 'uploading',
              progress: 0,
              error: null,
              controller: new AbortController(),
              el: null,
            };
            storage.entries.set(entry.id, entry);
            actions.push({ type: 'add', id: entry.id, pos: at });
            started.push(entry);
          }
          tr.setMeta(UPLOAD_PLUGIN_KEY, actions);
          // Uploaders start after this transaction is applied (run awaits a microtask first).
          for (const entry of started) run(editor, entry);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const storage = this.storage;

    const eligible = (files: File[]): File[] => {
      const canFile = storage.api!.handlers().uploadFile !== null;
      return files.filter((file) => isImageFile(file) || canFile);
    };

    const deco = (entry: Entry, pos: number) =>
      Decoration.widget(pos, () => storage.api!.widget(entry), {
        id: entry.id,
        key: `rcm-upload:${entry.id}:${entry.status}`,
        stopEvent: () => true,
        ignoreSelection: true,
      });

    return [
      new Plugin<DecorationSet>({
        key: UPLOAD_PLUGIN_KEY,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set, _old, newState) {
            let next = set.map(tr.mapping, tr.doc);
            const actions = tr.getMeta(UPLOAD_PLUGIN_KEY) as Action[] | undefined;
            for (const action of actions ?? []) {
              const existing = next.find(
                undefined,
                undefined,
                (spec) => (spec as { id?: number }).id === action.id,
              );
              const entry = storage.entries.get(action.id);
              if (action.type === 'remove') {
                next = next.remove(existing);
              } else if (entry && action.type === 'add') {
                next = next.add(newState.doc, [deco(entry, action.pos)]);
              } else if (entry && existing.length > 0) {
                const at = existing[0]!.from;
                next = next.remove(existing).add(newState.doc, [deco(entry, at)]);
              }
            }
            return next;
          },
        },
        view: () => ({
          update(view) {
            // Placeholders whose position was deleted with the content around them are cancelled.
            if (storage.entries.size === 0) return;
            for (const entry of [...storage.entries.values()]) {
              if (findPos(view.state, entry.id) === null) {
                storage.entries.delete(entry.id);
                entry.controller.abort();
              }
            }
          },
        }),
        props: {
          decorations: (state) => UPLOAD_PLUGIN_KEY.getState(state),
          handlePaste(_view, event) {
            const data = event.clipboardData;
            if (!data || data.files.length === 0) return false;
            // Office / spreadsheet copies carry a picture next to real text: paste the text.
            if (data.getData('text/plain').trim() !== '') return false;
            const html = data.getData('text/html');
            if (html.replace(/<[^>]*>/g, '').replace(/&nbsp;|\s/g, '') !== '') return false;
            const files = eligible(Array.from(data.files));
            if (files.length === 0) return false;
            event.preventDefault();
            return editor.commands.uploadFiles(files);
          },
          handleDrop(view, event, _slice, moved) {
            const data = event.dataTransfer;
            if (moved || !data || data.files.length === 0) return false;
            if (data.types.includes('application/x-prosemirror-slice')) return false;
            const files = eligible(Array.from(data.files));
            if (files.length === 0) return false;
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            event.preventDefault();
            return editor.commands.uploadFiles(files, at === undefined ? undefined : { at });
          },
        },
      }),
    ];
  },
});
