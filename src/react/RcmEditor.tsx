import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Extension, getHTMLFromFragment } from '@tiptap/core';
import type { Editor, EditorOptions, Extensions, JSONContent } from '@tiptap/core';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import {
  GUARD_REPLACE_META,
  isPolicyFixup,
  createEditorExtensions,
  expandRawHtmlPlaceholders,
  getContentReport,
  getLosslessHTML,
  getLosslessJSON,
  handleContentError,
  isContentLocked,
  peekLosslessHtml,
  refreshAssets,
  setEditorEditable,
  unwrapUnsupported,
} from '../index';
import type {
  ContentReport,
  EditorFeatures,
  HtmlPolicy,
  PolicyRemovedEntry,
  RawHtmlEntry,
  ResolveAsset,
  UploadHandlers,
} from '../index';
import type { RcmUploadError, RcmUploader } from '../upload/types';
import { normalizeDoc } from '../diagnostics/normalize';
import {
  TIPTAP_DUPLICATE_CODE,
  detectTiptapDuplicates,
  formatTiptapDuplicateWarning,
} from '../tiptapVersion';
import { RAW_HTML } from '../extensions/rawHtml';
import { htmlPolicyOf } from '../guard/contentGuard';
import { isDevelopment, warnOnce } from './devWarnings';
import { resolveLabels } from './labels';
import type { RcmEditorLabels } from './labels';
import { warnIfStylesMissing } from './styleCheck';
import { Toolbar } from './toolbar/Toolbar';
import { TableMenu } from './table/TableMenu';
import { ImageToolbar } from './image/ImageToolbar';
import { FindPanel } from './find/FindPanel';
import { hasCommands, normalizeToolbarProp } from './toolbar/items';
import type { RcmToolbarConfig, RcmToolbarPreset } from './toolbar/types';
import { CodeMirrorHost } from './source/CodeMirrorHost';
import { HtmlNotice } from './source/HtmlNotice';
import type { HtmlNoticeItem } from './source/HtmlNotice';
import { RawHtmlEditor } from './source/RawHtmlEditor';
import { applyFragmentToEditor, sourcePreviewPayload } from './source/apply';
import type { PolicyInputs } from './source/apply';

export type RcmEditorContent = string | JSONContent;

/**
 * `onChange` payload. Both fields are serialized lazily on first read (from the document as it
 * was when the change was emitted) — read only what you store.
 */
export interface RcmEditorChange {
  /** Lossless JSON: content the schema could not load is re-emitted as it came in. */
  readonly json: JSONContent;
  /** `getLosslessHTML(editor)` of the same document (unedited loads return the input verbatim). */
  readonly html: string;
}

/** A font the toolbar offers: `value` is the CSS font stack written to `fontFamily`. */
export interface RcmFontOption {
  label: string;
  value: string;
}

export type { RcmToolbarPreset } from './toolbar/types';

export type { RcmUploadContext, RcmUploadResult, RcmUploader } from '../upload/types';

export interface RcmEditorProps {
  /** Controlled content (HTML string or tiptap JSON). */
  value?: RcmEditorContent;
  /** Initial content when uncontrolled. */
  defaultValue?: RcmEditorContent;
  /** Debounced (`changeDebounceMs`) change notification; flushed on blur, unmount and `flush()`. */
  onChange?: (change: RcmEditorChange) => void;
  /** Debounce of `onChange` in ms (default 100, `0` = every transaction). */
  changeDebounceMs?: number;
  readonly?: boolean;
  /** Partial labels (Korean defaults for the rest). */
  labels?: Partial<RcmEditorLabels>;
  /** Display resolver for `asset:` image srcs (same as `features.image.resolveAsset`). */
  resolveAsset?: ResolveAsset;
  /**
   * Image uploader for paste, drop and the toolbar `image` item. Default `base64Uploader()`.
   * Built-ins: `@rchemist/editor/upload`. The latest prop is always used.
   */
  uploadImage?: RcmUploader;
  /** Uploader of non-image files (inserted as a link); without it such files are ignored. */
  uploadFile?: RcmUploader;
  /** Called when an upload fails (the document is unchanged; an error placeholder is shown). */
  onUploadError?: (error: RcmUploadError, file: File) => void;
  /** Fonts offered by the toolbar font menu. */
  fonts?: readonly RcmFontOption[];
  /** Toolbar preset or configuration (default `'full'`). `false` hides the toolbar. */
  toolbar?: RcmToolbarPreset | RcmToolbarConfig | false;
  /**
   * HTML input security policy (default `'sanitize'`). Read once at creation, like
   * `features` (remount with a React `key` to change it); fills `features.contentGuard`
   * and the `rawHtml` preview unless those are set explicitly.
   */
  htmlPolicy?: HtmlPolicy;
  /** Hosts whose https `iframe` embeds the `sanitize` policy keeps (default YouTube·Vimeo). */
  iframeHosts?: string[];
  /**
   * Mod-F inside the editor opens the find & replace panel instead of the browser find
   * (default `true`). `false` leaves the key untouched for the browser.
   */
  findShortcut?: boolean;
  /**
   * HTML source mode (default `true`): the toolbar `source` toggle replaces the editing
   * area with a lazily loaded CodeMirror editor over `getLosslessHTML()`. `false` hides the
   * toggle (the raw-fragment popover of `rawHtml` nodes still works).
   */
  sourceMode?: boolean;
  /** Cell context menu of tables (default `true`). `false` keeps the browser menu. */
  tableMenu?: boolean;
  /** Floating image bar with alignment, caption, alt text and resize handles (default `true`). */
  imageToolbar?: boolean;
  /** Minimum height of the editing area (number = px). */
  minHeight?: number | string;
  /**
   * Array: appended to the defaults. Function: receives the defaults, its result is used as-is.
   * Read once at creation (like `features`); remount with a React `key` to change them.
   */
  extensions?: Extensions | ((defaults: Extensions) => Extensions);
  /** Per built-in feature: `false` disables it, an options object is merged onto our defaults. */
  features?: EditorFeatures;
  /** Passed through to tiptap / ProseMirror `EditorProps` (updates are applied). */
  editorProps?: EditorOptions['editorProps'];
  onReady?: (editor: Editor) => void;
  /**
   * Incoming content had parts the schema does not know (kept as unsupported placeholders and
   * re-emitted in `onChange().json`), HTML elements without a parse rule, or could not be loaded
   * at all (`fatal`: the editor turns read-only and keeps the original).
   */
  onContentReport?: (report: ContentReport, editor: Editor) => void;
  className?: string;
  /**
   * Create the editor during the first render (client-only apps). Default `false`: the editor is
   * created after mount, which keeps server rendering safe.
   */
  immediatelyRender?: boolean;
}

/** Imperative handle (`ref`). */
export interface RcmEditorHandle {
  /** The tiptap editor (null before it is created on the client). */
  readonly editor: Editor | null;
  /** Emits a pending debounced `onChange` now. */
  flush(): void;
}

/** Transaction meta of the component's own `value` loads (allowed while `readonly`). */
export const VALUE_LOAD_META = 'rcmValueLoad';
/** Echo detection keeps this many recent `onChange` payloads. */
const ECHO_LIMIT = 8;

function resolveExtensions(
  extensions: RcmEditorProps['extensions'],
  features: EditorFeatures | undefined,
  resolveAsset: ResolveAsset | undefined,
  onContentReport: (report: ContentReport, editor: Editor) => void,
  htmlPolicy: HtmlPolicy | undefined,
  iframeHosts: string[] | undefined,
): Extensions {
  const defaults = createEditorExtensions({
    features,
    resolveAsset,
    onContentReport,
    htmlPolicy,
    iframeHosts,
  });
  if (typeof extensions === 'function') return extensions(defaults);
  return extensions ? [...defaults, ...extensions] : defaults;
}

/** Refuses document changes while `readonly`, except content loads (value / setContent). */
function readonlyLock(isReadonly: () => boolean) {
  return Extension.create({
    name: 'rcmReadonlyLock',
    addProseMirrorPlugins: () => [
      new Plugin({
        key: new PluginKey('rcmReadonlyLock'),
        filterTransaction: (tr) =>
          !tr.docChanged ||
          !isReadonly() ||
          tr.getMeta(VALUE_LOAD_META) === true ||
          tr.getMeta(GUARD_REPLACE_META) === true ||
          isPolicyFixup(tr),
      }),
    ],
  });
}

/** A stable resolver calling the latest `resolveAsset` prop (keeps `add()` for insertDocument). */
function latestResolver(get: () => ResolveAsset | undefined): ResolveAsset {
  const resolver: ResolveAsset & { add?: (assets: unknown) => void } = (src) => get()?.(src);
  resolver.add = (assets) => (get() as { add?: (a: unknown) => void } | undefined)?.add?.(assets);
  return resolver;
}

/** `features` with the latest-prop upload handlers wired into the `upload` feature. */
function withUploadHandlers(
  features: EditorFeatures | undefined,
  handlers: () => UploadHandlers,
): EditorFeatures {
  const own = features?.upload;
  if (own === false) return features ?? {};
  return { ...features, upload: { ...(typeof own === 'object' ? own : {}), handlers } };
}

/** Dev only: warn once when extensions/plugins come from a duplicated tiptap install. */
const keptNodeViews = new WeakSet<object>();

/**
 * tiptap's `EditorContent` drops every node view on unmount (`setProps({ nodeViews: {} })`), so
 * ProseMirror re-renders those nodes through `renderHTML` in the live document right before the
 * editor is destroyed: every image there starts loading its document src (`asset:` srcs fail
 * with ERR_UNKNOWN_URL_SCHEME). The editor's own node views have no React parts: keep them.
 */
function keepNodeViewsOnUnmount(editor: Editor): void {
  if (editor.isDestroyed) return;
  const view = editor.view;
  if (keptNodeViews.has(view)) return;
  const setProps = view.setProps.bind(view);
  view.setProps = (props) => {
    const nodeViews = props.nodeViews;
    if (nodeViews && Object.keys(nodeViews).length === 0) {
      const rest = { ...props };
      delete rest.nodeViews;
      setProps(rest);
      return;
    }
    setProps(props);
  };
  keptNodeViews.add(view);
}

function reportDuplicates(target: Editor | Extensions): void {
  if (!isDevelopment()) return;
  const findings = detectTiptapDuplicates(target);
  if (findings.length)
    warnOnce(TIPTAP_DUPLICATE_CODE, () => formatTiptapDuplicateWarning(findings));
}

function sameContent(editor: Editor, value: RcmEditorContent): boolean {
  if (typeof value === 'string') return getLosslessHTML(editor) === value;
  try {
    // ProseMirror-level equivalence: null attributes, empty arrays, mark order, split text.
    return (
      JSON.stringify(normalizeDoc(getLosslessJSON(editor))) === JSON.stringify(normalizeDoc(value))
    );
  } catch {
    // Not serializable (e.g. cyclic): let the guard load and report it.
    return false;
  }
}

function cssLength(value: number | string | undefined): string | undefined {
  return typeof value === 'number' ? `${value}px` : value;
}

/** Source mode snapshot: `entry` is the text the mode started from. */
interface SourceModeState {
  /** Current source text (CodeMirror drives it). */
  text: string;
  /** `getLosslessHTML()` captured at entry: an unchanged exit never touches the document. */
  entry: string;
  /** Schema + policy captured at entry — payload building stays valid after a destroy. */
  schema: Schema;
  inputs: PolicyInputs;
}

/** Raw-fragment popover state, anchored to the `rawHtml` node's preview rect. */
interface RawEditState {
  pos: number;
  text: string;
  left: number;
  top: number;
}

/** Document position of a raw preview element (the node before the inner position, if any). */
function rawPosFromDom(editor: Editor, dom: Element): number | null {
  try {
    const base = editor.view.posAtDOM(dom, 0);
    for (const pos of [base, base - 1]) {
      const node = editor.state.doc.nodeAt(pos);
      if (node && node.type.name === RAW_HTML) return pos;
    }
  } catch {
    // Detached or foreign DOM: no position to anchor to.
  }
  return null;
}

/** Notice lines for what an apply kept verbatim (`rawHtml`) or the policy removed. */
function noticeItems(
  labels: RcmEditorLabels,
  rawHtml: readonly RawHtmlEntry[],
  policyRemoved: readonly PolicyRemovedEntry[],
): HtmlNoticeItem[] {
  const items: HtmlNoticeItem[] = [];
  for (const entry of rawHtml) {
    const head = entry.detail ? `${labels.htmlNoticeRaw} — ${entry.detail}` : labels.htmlNoticeRaw;
    items.push({ reason: entry.reason, text: `${head}: ${entry.html}` });
  }
  for (const entry of policyRemoved) {
    items.push({ reason: entry.kind, text: `${labels.htmlNoticeRemoved} — ${entry.detail}` });
  }
  return items;
}

/** Runs after the re-render that unhides the editing area, so `focus()` is not a no-op. */
const afterPaint =
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (cb: () => void) => setTimeout(cb, 0);

export const RcmEditor = forwardRef<RcmEditorHandle, RcmEditorProps>(function RcmEditor(
  {
    value,
    defaultValue,
    onChange,
    changeDebounceMs = 100,
    readonly = false,
    labels,
    resolveAsset,
    uploadImage,
    uploadFile,
    onUploadError,
    fonts,
    toolbar,
    htmlPolicy,
    iframeHosts,
    findShortcut = true,
    sourceMode = true,
    tableMenu = true,
    imageToolbar = true,
    minHeight,
    extensions,
    features,
    editorProps,
    onReady,
    onContentReport,
    className,
    immediatelyRender = false,
  },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  const onContentReportRef = useRef(onContentReport);
  const resolveAssetRef = useRef(resolveAsset);
  const assetResolverRef = useRef<ResolveAsset | undefined>(undefined);
  const uploadRef = useRef({ uploadImage, uploadFile, onUploadError });
  const labelsRef = useRef<RcmEditorLabels | null>(null);
  const readonlyRef = useRef(readonly);
  const debounceRef = useRef(changeDebounceMs);
  useEffect(() => {
    onChangeRef.current = onChange;
    onReadyRef.current = onReady;
    onContentReportRef.current = onContentReport;
    resolveAssetRef.current = resolveAsset;
    debounceRef.current = changeDebounceMs;
  });
  // Read by the lock filter during this render's effects already.
  readonlyRef.current = readonly;
  // Same for the upload handlers: `available` toolbar items (the `file` button) read them
  // while the toolbar resolves, in this render — not only after the effect above.
  uploadRef.current = { uploadImage, uploadFile, onUploadError };

  // Extensions and features are read once at creation. Duplicates are checked before creation
  // too: tiptap may throw on mixed installs.
  const [resolvedExtensions] = useState(() => {
    // The initial content is reported while the editor is created, before effects run.
    onContentReportRef.current = onContentReport;
    assetResolverRef.current = resolveAsset && latestResolver(() => resolveAssetRef.current);
    const list = resolveExtensions(
      extensions,
      withUploadHandlers(features, () => {
        const l = labelsRef.current;
        return {
          ...uploadRef.current,
          ...(l && {
            labels: {
              uploading: l.uploading,
              failed: l.uploadFailed,
              retry: l.uploadRetry,
              dismiss: l.uploadDismiss,
            },
          }),
        };
      }),
      assetResolverRef.current,
      (report, e) => onContentReportRef.current?.(report, e),
      htmlPolicy,
      iframeHosts,
    );
    reportDuplicates(list);
    // The lock goes first: a consumer's extensions stay at the end of the list.
    return [readonlyLock(() => readonlyRef.current), ...list];
  });
  const [initialContent] = useState(() => value ?? defaultValue ?? '');

  const resolvedLabels = useMemo(() => resolveLabels(labels), [labels]);
  labelsRef.current = resolvedLabels;
  const areaLabel = resolvedLabels.editorArea;
  const toolbarConfig = readonly ? null : normalizeToolbarProp(toolbar);
  const mergedEditorProps = useMemo<EditorOptions['editorProps']>(() => {
    const consumer = editorProps?.attributes;
    return {
      ...editorProps,
      attributes: (state) => ({
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': areaLabel,
        spellcheck: 'true',
        ...(readonlyRef.current ? { 'aria-readonly': 'true', tabindex: '0' } : {}),
        ...(typeof consumer === 'function' ? consumer(state) : consumer),
      }),
    };
  }, [editorProps, areaLabel]);

  // --- change notification -------------------------------------------------------------------
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<Editor | null>(null);
  /** Source mode snapshot, kept in sync synchronously (`setSource` alone lags a render). */
  const sourceRef = useRef<SourceModeState | null>(null);
  /** Recent payload values handed to the consumer: an echo of one of them is not a new value. */
  const emittedRef = useRef<unknown[]>([]);

  const remember = useCallback((v: unknown) => {
    const list = emittedRef.current;
    list.push(v);
    if (list.length > ECHO_LIMIT) list.shift();
  }, []);

  const emit = useCallback(
    (editor: Editor) => {
      const handler = onChangeRef.current;
      if (!handler) return;
      // Source mode: the payload reflects the source text, not the hidden document.
      const src = sourceRef.current;
      if (src) {
        let payload: { html: string; json: JSONContent } | undefined;
        const preview = () => (payload ??= sourcePreviewPayload(src.schema, src.text, src.inputs));
        let json: JSONContent | undefined;
        let html: string | undefined;
        handler({
          get json() {
            if (json === undefined) {
              json = preview().json;
              remember(json);
            }
            return json;
          },
          get html() {
            if (html === undefined) {
              html = preview().html;
              remember(html);
            }
            return html;
          },
        });
        return;
      }
      const doc: PMNode = editor.state.doc;
      const schema = editor.schema;
      const locked = isContentLocked(editor) ? getLosslessJSON(editor) : null;
      // The payload serializes lazily from the document as emitted (destroy-safe: no live
      // editor access on read); an unedited HTML load reads back verbatim.
      const lossless = peekLosslessHtml(editor);
      let json: JSONContent | undefined;
      let html: string | undefined;
      handler({
        get json() {
          if (json === undefined) {
            json = locked ?? unwrapUnsupported(doc.toJSON() as JSONContent);
            remember(json);
          }
          return json;
        },
        get html() {
          if (html === undefined) {
            html = lossless ?? expandRawHtmlPlaceholders(getHTMLFromFragment(doc.content, schema));
            remember(html);
          }
          return html;
        },
      });
    },
    [remember],
  );

  const flush = useCallback(() => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    if (editorRef.current) emit(editorRef.current);
  }, [emit]);

  const cancelPending = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const editor = useEditor({
    immediatelyRender,
    extensions: resolvedExtensions,
    content: initialContent,
    editable: !readonly,
    // Last-resort net behind the content guard: never throw, never silently empty the document.
    enableContentCheck: true,
    onContentError: handleContentError,
    editorProps: mergedEditorProps,
    onCreate: ({ editor: e }) => {
      reportDuplicates(e);
      onReadyRef.current?.(e);
    },
    onUpdate: ({ editor: e }) => {
      if (!onChangeRef.current) return;
      const wait = debounceRef.current;
      if (wait <= 0) {
        emit(e);
        return;
      }
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        emit(e);
      }, wait);
    },
    onBlur: () => flush(),
  });

  useEffect(() => {
    if (editor) keepNodeViewsOnUnmount(editor);
  }, [editor]);

  useEffect(() => {
    editorRef.current = editor;
    // Unmount or editor swap: the last edits are not lost.
    return () => flush();
  }, [editor, flush]);

  useImperativeHandle(
    ref,
    () => ({
      get editor() {
        return editor;
      },
      flush,
    }),
    [editor, flush],
  );

  useEffect(() => {
    if (!editor) return;
    setEditorEditable(editor, !readonly);
    // aria-readonly is computed by the attributes function.
    editor.setOptions({});
  }, [editor, readonly]);

  useEffect(() => {
    if (!editor || value === undefined) return;
    if (emittedRef.current.includes(value) || sameContent(editor, value)) return;
    // The external value wins over pending local edits (their payload would echo it back) and
    // over an open source mode: the mode closes without applying its pending text.
    cancelPending();
    emittedRef.current = [];
    if (sourceRef.current) {
      sourceRef.current = null;
      setSource(null);
      setRawEdit(null);
    }
    editor.chain().setMeta(VALUE_LOAD_META, true).setContent(value, { emitUpdate: false }).run();
    setEditorEditable(editor, !readonlyRef.current);
  }, [editor, value]);

  useEffect(() => {
    // A new resolver may know assets the old one did not: images shown as missing try again.
    refreshAssets(assetResolverRef.current);
  }, [resolveAsset]);

  useEffect(() => {
    if (rootRef.current) warnIfStylesMissing(rootRef.current);
  }, []);

  // --- find & replace panel -----------------------------------------------------------
  // `seq` remounts the panel on repeated Mod-F so the input is focused and the term selected.
  const [find, setFind] = useState({ open: false, seq: 0 });
  const canFind = !!editor && hasCommands(editor, ['setSearchTerm']);
  const openFind = useCallback(() => setFind((f) => ({ open: true, seq: f.seq + 1 })), []);
  const closeFind = useCallback(() => {
    setFind((f) => (f.open ? { ...f, open: false } : f));
    const e = editorRef.current;
    if (!e || e.isDestroyed) return;
    if (hasCommands(e, ['clearSearch'])) e.commands.clearSearch();
    e.commands.focus();
  }, []);

  // --- HTML source mode ----------------------------------------------------------------
  const [source, setSource] = useState<SourceModeState | null>(null);
  const [notice, setNotice] = useState<readonly HtmlNoticeItem[] | null>(null);
  const [rawEdit, setRawEdit] = useState<RawEditState | null>(null);
  const sourceOpen = !!source;

  const enterSource = useCallback(() => {
    const e = editorRef.current;
    if (!e || e.isDestroyed || sourceRef.current) return;
    // Deliver pending WYSIWYG changes first (their payload comes from the document).
    flush();
    const html = getLosslessHTML(e);
    const next: SourceModeState = {
      text: html,
      entry: html,
      schema: e.schema,
      inputs: htmlPolicyOf(e),
    };
    sourceRef.current = next;
    setSource(next);
    setRawEdit(null);
  }, [flush]);

  const exitSource = useCallback(() => {
    const st = sourceRef.current;
    if (!st) return;
    // Deliver any pending source change while the payload still describes the source.
    flush();
    const e = editorRef.current;
    if (e && !e.isDestroyed && st.text !== st.entry) {
      // Changed: apply before leaving. A refused apply keeps source mode open so the edited
      // source is never discarded.
      if (!e.chain().setContent(st.text, { emitUpdate: true }).run()) return;
    }
    sourceRef.current = null;
    setSource(null);
    if (!e || e.isDestroyed) return;
    if (st.text === st.entry) {
      // Unchanged: the document is never touched — cursor and undo history stay as they were.
      afterPaint(() => {
        const cur = editorRef.current;
        if (cur && !cur.isDestroyed) cur.commands.focus();
      });
      return;
    }
    // Applied above in one transaction through the same preservation path as any content load.
    const l = labelsRef.current;
    const report = getContentReport(e);
    if (l && report) {
      const items = noticeItems(l, report.rawHtml, report.policyRemoved);
      setNotice(items.length > 0 ? items : null);
    }
    afterPaint(() => {
      const cur = editorRef.current;
      if (cur && !cur.isDestroyed) cur.commands.focus();
    });
  }, [flush]);

  const toggleSource = useCallback(() => {
    if (sourceRef.current) exitSource();
    else enterSource();
  }, [enterSource, exitSource]);

  const onSourceText = useCallback(
    (text: string) => {
      const st = sourceRef.current;
      if (!st || st.text === text) return;
      const next = { ...st, text };
      sourceRef.current = next; // synchronous: emit/flush read this before the re-render
      setSource(next);
      if (!onChangeRef.current) return;
      const wait = debounceRef.current;
      if (wait <= 0) {
        const e = editorRef.current;
        if (e) emit(e);
        return;
      }
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const e = editorRef.current;
        if (e) emit(e);
      }, wait);
    },
    [emit],
  );

  // --- rawHtml fragment popover --------------------------------------------------------
  const openRawEditor = useCallback((pos: number) => {
    const e = editorRef.current;
    if (!e || e.isDestroyed) return;
    const node = e.state.doc.nodeAt(pos);
    if (!node || node.type.name !== RAW_HTML) return;
    const dom = e.view.nodeDOM(pos);
    const rect = dom instanceof HTMLElement ? dom.getBoundingClientRect() : null;
    setRawEdit({
      pos,
      text: typeof node.attrs.html === 'string' ? node.attrs.html : '',
      left: rect ? Math.max(8, Math.min(rect.left, window.innerWidth - 8)) : 8,
      top: rect ? rect.bottom + 4 : 8,
    });
  }, []);

  const runRawAction = (mode: 'apply' | 'convert') => {
    const st = rawEdit;
    if (!st) return;
    const e = editorRef.current;
    if (!e || e.isDestroyed) return;
    const result = applyFragmentToEditor(e, st.pos, st.text, mode, htmlPolicyOf(e));
    setRawEdit(null);
    const l = labelsRef.current;
    if (result && l) {
      const items = noticeItems(l, result.rawHtml, result.policyRemoved);
      setNotice(items.length > 0 ? items : null);
    }
    e.commands.focus();
  };

  // The popover closes when its node is gone (applied, converted, undone or deleted elsewhere).
  useEffect(() => {
    if (!rawEdit || !editor) return undefined;
    const check = () => {
      const node = editor.state.doc.nodeAt(rawEdit.pos);
      if (!node || node.type.name !== RAW_HTML) setRawEdit(null);
    };
    editor.on('transaction', check);
    return () => {
      editor.off('transaction', check);
    };
  }, [rawEdit, editor]);

  // Mod-F reaches this handler only while the focus is inside the editor root (editing area,
  // toolbar, panel); outside it stays the browser's own find. `findShortcut: false` or a
  // disabled `findAndReplace` feature leaves the event untouched. In source mode the source
  // editor keeps the key (its own search panel).
  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!findShortcut || event.defaultPrevented || sourceOpen) return;
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    if (event.key !== 'f' && event.key !== 'F') return;
    const e = editorRef.current;
    if (!e || !hasCommands(e, ['setSearchTerm'])) return;
    event.preventDefault();
    openFind();
  };

  // Enter on a selected `rawHtml` node opens its fragment editor (capture: PM must not split).
  const onRootKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || sourceOpen || readonly || event.defaultPrevented) return;
    const e = editorRef.current;
    if (!e || e.isDestroyed) return;
    const selection = e.state.selection;
    if (!(selection instanceof NodeSelection) || selection.node.type.name !== RAW_HTML) return;
    event.preventDefault();
    event.stopPropagation();
    openRawEditor(selection.from);
  };

  // Double-click on a raw preview opens the same fragment editor.
  const onRootDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (sourceOpen || readonly) return;
    const e = editorRef.current;
    if (!e || e.isDestroyed) return;
    const host = (event.target as Element | null)?.closest?.('[data-rcm-raw-html-preview]');
    if (!host) return;
    const pos = rawPosFromDom(e, host);
    if (pos === null) return;
    event.preventDefault();
    openRawEditor(pos);
  };

  // `sourceMode: false` hides the toggle the same way an explicit `config.hide` would.
  const toolbarResolved = useMemo<RcmToolbarConfig | null>(() => {
    if (!toolbarConfig || sourceMode) return toolbarConfig;
    return { ...toolbarConfig, hide: [...(toolbarConfig.hide ?? []), 'source'] };
  }, [toolbarConfig, sourceMode]);

  const classes = ['rcm-editor'];
  if (readonly) classes.push('rcm-editor--readonly');
  if (sourceOpen) classes.push('rcm-editor--source');
  if (className) classes.push(className);
  const height = cssLength(minHeight);
  const style = height ? ({ '--rcm-editor-min-height': height } as CSSProperties) : undefined;

  return (
    <div
      ref={rootRef}
      className={classes.join(' ')}
      data-rcm-editor=""
      data-readonly={readonly ? '' : undefined}
      style={style}
      onKeyDown={onRootKeyDown}
      onKeyDownCapture={onRootKeyDownCapture}
      onDoubleClick={onRootDoubleClick}
    >
      {editor && toolbarResolved && (
        <Toolbar
          editor={editor}
          labels={resolvedLabels}
          config={toolbarResolved}
          fonts={fonts}
          onFind={canFind ? openFind : undefined}
          onSourceToggle={sourceMode && !readonly ? toggleSource : undefined}
          sourceActive={sourceOpen}
        />
      )}
      {editor && find.open && canFind && (
        <FindPanel
          key={find.seq}
          editor={editor}
          labels={resolvedLabels}
          readonly={readonly}
          onClose={closeFind}
        />
      )}
      {editor && notice && (
        <HtmlNotice items={notice} labels={resolvedLabels} onClose={() => setNotice(null)} />
      )}
      {/* Stays mounted while the source editor is shown: unmounting would reset the editor DOM. */}
      <EditorContent editor={editor} hidden={sourceOpen} />
      {editor && sourceOpen && source && (
        <CodeMirrorHost
          className="rcm-source"
          testId="rcm-source-editor"
          doc={source.text}
          ariaLabel={resolvedLabels.sourceEditor}
          focus
          onTextChange={onSourceText}
          onBlurLeave={flush}
        />
      )}
      {editor && rawEdit && !sourceOpen && (
        <RawHtmlEditor
          labels={resolvedLabels}
          text={rawEdit.text}
          left={rawEdit.left}
          top={rawEdit.top}
          onTextChange={(text) => setRawEdit((st) => (st ? { ...st, text } : st))}
          onApply={() => runRawAction('apply')}
          onConvert={() => runRawAction('convert')}
          onClose={() => setRawEdit(null)}
        />
      )}
      {editor && tableMenu && !readonly && hasCommands(editor, ['addRowAfter']) && (
        <TableMenu editor={editor} labels={resolvedLabels} />
      )}
      {editor && imageToolbar && !readonly && hasCommands(editor, ['setImageAlign']) && (
        <ImageToolbar editor={editor} labels={resolvedLabels} />
      )}
    </div>
  );
});
