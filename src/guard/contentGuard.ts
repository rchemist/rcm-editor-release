// content guard extension: no input may silently empty or shrink the document.
import { Extension, commands as coreCommands } from '@tiptap/core';
import type { Content, Editor, EditorOptions, JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { fixTablesKey } from '@tiptap/pm/tables';
import { preserveHtmlForLoad, sanitizeRawHtmlPlaceholders } from '../html/preserve';
import { applyHtmlPolicy } from '../html/policy';
import type { HtmlPolicy, PolicyRemovedEntry } from '../html/policy';
import { RAW_HTML } from '../extensions/rawHtml';
import {
  cloneJson,
  fatalDocument,
  guardDocument,
  guardFragment,
  hasGuardTypes,
  isReportEmpty,
  scanUnknownHtml,
  unwrapUnsupported,
} from './guard';
import type { ContentReport } from './guard';
import {
  UNSUPPORTED_ATTRS,
  UnsupportedInline,
  UnsupportedMark,
  UnsupportedNode,
  parseJsonAttribute,
} from './unsupported';
import type { UnsupportedLabels } from './unsupported';

export type ContentReportHandler = (report: ContentReport, editor: Editor) => void;

/**
 * HTML input hook, run before tiptap parses HTML (`initial`, `setContent`, `insertContent`).
 * Return HTML (e.g. with unknown elements turned into `rawHtml` markup) or tiptap JSON
 * (which then goes through the JSON guard).
 */
export type PreprocessHtml = (
  html: string,
  context: { editor: Editor; source: ContentReport['source'] },
) => string | JSONContent | JSONContent[];

export interface ContentGuardOptions {
  /** Called whenever incoming content had unsupported parts (or the guard failed). */
  onContentReport: ContentReportHandler | null;
  /**
   * HTML input hook, run before the policy and the `rawHtml` preservation: the hook's
   * string result goes through policy + preservation like any other HTML input; a JSON result
   * goes through the JSON guard.
   */
  preprocessHtml: PreprocessHtml | null;
  /** HTML input security policy (default `'sanitize'`). Creation-time, like `features`. */
  htmlPolicy: HtmlPolicy | null;
  /** Hosts whose https `iframe` embeds the `sanitize` policy keeps. */
  iframeHosts: string[] | null;
  /** Placeholder text of unsupported nodes (merged onto the Korean defaults). */
  labels: Partial<UnsupportedLabels>;
}

export interface ContentGuardStorage {
  /** Report of the last content that came in (also when empty). */
  lastReport: ContentReport | null;
  /**
   * Set after a guard failure: the original content, returned by `getLosslessJSON()`. While set,
   * the document is locked: every transaction that would change it is refused (commands return
   * false), so the original never goes stale. A successful `setContent` clears it and restores
   * the editability from before the failure.
   */
  fatal: { message: string; original: unknown } | null;
  /** @internal `editable` option from before the guard failure (restored on recovery). */
  editableBeforeFatal: boolean | null;
  /** @internal set while the guard's setContent delegates to core (no double report). */
  busy: boolean;
  /** @internal last whole-document content as given (initial / setContent), for the net. */
  lastInput: unknown;
  /**
   * @internal last loaded HTML after the policy (before `rawHtml` wrapping), for
   * `getLosslessHTML()`. Null after JSON loads and guard failures.
   */
  losslessHtml: string | null;
  /** @internal document the `losslessHtml` was loaded into (`doc.eq` decides verbatim output). */
  losslessDoc: PMNode | null;
  /**
   * @internal policy verdicts by payload (`cleanRawHtmlPayload`): the choke point's cache, so a
   * repeated payload (paste the same markup twice) is not re-sanitized.
   */
  policyVerdicts: Map<string, PolicyVerdict>;
}

/** Result of cleaning one `rawHtml` payload under the editor's current policy. */
export interface PolicyVerdict {
  html: string;
  removed: PolicyRemovedEntry[];
}

/**
 * Tracks the document the editor state was created with. `peekLosslessHtml()` compares it for
 * initial HTML loads — synchronously, because tiptap emits `create` asynchronously on mount and
 * headless editors never mount at all.
 */
const initialDocKey = new PluginKey<PMNode | null>('rcmInitialDoc');

const GUARD = 'contentGuard';
/** Transaction meta of a whole-document load through the guard's `setContent`. */
export const CONTENT_LOAD_META = 'rcmContentLoad';
/** Transaction meta of the guard's own `setContent` (the only change allowed while fatal). */
export const GUARD_REPLACE_META = 'rcmGuardReplace';

function storageOf(editor: Editor): ContentGuardStorage | undefined {
  return (editor.storage as unknown as Record<string, ContentGuardStorage | undefined>)[GUARD];
}

function optionsOf(editor: Editor): ContentGuardOptions | undefined {
  const ext = editor.extensionManager.extensions.find((e) => e.name === GUARD);
  return ext?.options as ContentGuardOptions | undefined;
}

/** Records `report` as the editor's last report and calls `onContentReport` when it is not empty. */
export function emitContentReport(editor: Editor, report: ContentReport): void {
  const storage = storageOf(editor);
  if (storage) storage.lastReport = report;
  if (!isReportEmpty(report)) optionsOf(editor)?.onContentReport?.(report, editor);
}

function goFatal(editor: Editor, report: ContentReport, original: unknown, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const storage = storageOf(editor);
  if (storage) {
    if (!storage.fatal) storage.editableBeforeFatal = editor.options.editable !== false;
    storage.fatal = { message, original: safeClone(original) };
  }
  report.fatal = { message };
  editor.setEditable(false, false);
}

/** True while a guard failure locks the document (see `ContentGuardStorage.fatal`). */
export function isContentLocked(editor: Editor): boolean {
  return !!storageOf(editor)?.fatal;
}

/**
 * `editor.setEditable()` that respects a guard failure: while fatal the editor stays read-only and
 * `editable` becomes the editability restored by the next successful load.
 */
export function setEditorEditable(editor: Editor, editable: boolean): void {
  const storage = storageOf(editor);
  if (storage?.fatal) {
    storage.editableBeforeFatal = editable;
    return;
  }
  if (editor.isEditable !== editable) editor.setEditable(editable, false);
}

/** Leaves the fatal state after a successful load: original dropped, editability restored. */
function recover(editor: Editor): void {
  const storage = storageOf(editor);
  if (!storage?.fatal) return;
  storage.fatal = null;
  const editable = storage.editableBeforeFatal ?? true;
  storage.editableBeforeFatal = null;
  if (editable) editor.setEditable(true, false);
}

function safeClone(value: unknown): unknown {
  try {
    return typeof value === 'string' ? value : cloneJson(value);
  } catch {
    return value;
  }
}

const isJsonContent = (content: unknown): boolean =>
  typeof content === 'object' &&
  content !== null &&
  typeof (content as { nodesBetween?: unknown }).nodesBetween !== 'function';

/** What setContent / insertContentAt accept (JSON, HTML, or ProseMirror node/fragment). */
type AnyContent = Parameters<typeof coreCommands.setContent>[0];
type Prepared = { content: AnyContent; report: ContentReport; losslessHtml: string | null };

function policyOf(editor: Editor, source: ContentReport['source']) {
  const options = optionsOf(editor);
  return {
    policy: options?.htmlPolicy ?? undefined,
    iframeHosts: options?.iframeHosts ?? undefined,
    source,
  };
}

/**
 * The choke point's own fixups (already policy-clean; never re-scanned). A module-private set
 * of transaction objects rather than a meta key: `PluginKey` metas resolve to predictable
 * strings (`'rcmPolicyFixup$'`), so user code could forge one and skip the policy.
 */
const policyFixups = new WeakSet<Transaction>();

/** Whether `tr` is the policy choke point's own cleanup (readonly locks must let it through). */
export function isPolicyFixup(tr: Transaction): boolean {
  return policyFixups.has(tr);
}

/**
 * single policy choke point. Every document change passes through `appendTransaction`:
 * `rawHtml` nodes created or changed by a transaction (changed ranges only — located with
 * `findDiffStart`/`findDiffEnd`, verdicts cached by payload) whose `html` is not clean under the
 * editor's current policy are replaced with the cleaned value in the appended transaction. The
 * appended transaction joins the triggering transaction's history group (`addToHistory`
 * mirrored), so the cleanup undoes with the change that introduced it. Removals are reported
 * through the existing `onContentReport` channel with source `insertContent` (the only
 * post-load document-change source); `trusted` skips everything. This covers insertDocument,
 * commands, paste, drop, JSON, collab and direct `tr.setNodeMarkup` calls — any path.
 */
function policyChokePlugin(editor: Editor): Plugin {
  return new Plugin({
    key: new PluginKey('rcmPolicyChoke'),
    appendTransaction(transactions, oldState, newState) {
      if (editor.isDestroyed) return null;
      const triggering = transactions.filter((tr) => tr.docChanged && !policyFixups.has(tr));
      if (!triggering.length) return null;
      const { policy, iframeHosts } = policyOf(editor, 'insertContent');
      if (policy === 'trusted') return null;
      const start = oldState.doc.content.findDiffStart(newState.doc.content);
      if (start == null) return null;
      const end = oldState.doc.content.findDiffEnd(newState.doc.content);
      if (!end) return null;
      const from = Math.max(0, Math.min(start, end.b));
      const to = Math.min(newState.doc.content.size, Math.max(start, end.b));
      if (from > to) return null;
      const fixes: {
        pos: number;
        attrs: Record<string, unknown>;
        removed: PolicyRemovedEntry[];
      }[] = [];
      const allRemoved: PolicyRemovedEntry[] = [];
      newState.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name !== RAW_HTML || typeof node.attrs.html !== 'string') return;
        if (node.attrs.html === '') return;
        const verdict = cleanRawHtmlPayload(editor, node.attrs.html, {
          policy,
          iframeHosts,
          source: 'insertContent',
        });
        if (verdict.html === node.attrs.html) return;
        fixes.push({ pos, attrs: { ...node.attrs, html: verdict.html }, removed: verdict.removed });
        allRemoved.push(...verdict.removed);
      });
      if (!fixes.length) return null;
      const tr = newState.tr;
      for (const fix of fixes) tr.setNodeMarkup(fix.pos, undefined, fix.attrs);
      policyFixups.add(tr);
      // Same history group: history joins appended transactions automatically; mirror an
      // explicit opt-out so the cleanup never becomes undoable on its own.
      if (triggering.some((t) => t.getMeta('addToHistory') === false))
        tr.setMeta('addToHistory', false);
      if (allRemoved.length)
        emitContentReport(editor, {
          source: 'insertContent',
          format: 'json',
          unsupported: [],
          unknownHtml: [],
          rawHtml: [],
          policyRemoved: allRemoved.slice(0, 500),
        });
      return tr;
    },
  });
}

/**
 * Paste/drop policy as a ProseMirror plugin prop (item 4). ProseMirror chains every
 * `transformPastedHTML` prop (direct props first, then each plugin's), so — unlike the old
 * extension-level hook, which tiptap composes into `editorProps.transformPastedHTML` and
 * `editor.setOptions` / a consumer `editorProps.transformPastedHTML` replaces — this one can
 * never be replaced. The choke point backstops it anyway (a consumer transform that runs after
 * and reintroduces policy-violating markup still lands in the document dirty, then gets fixed).
 */
function pastePolicyPlugin(editor: Editor): Plugin {
  return new Plugin({
    key: new PluginKey('rcmPastePolicy'),
    props: {
      transformPastedHTML(html: string): string {
        if (editor.isDestroyed) return html;
        const { policy, iframeHosts } = policyOf(editor, 'insertContent');
        if (policy === 'trusted') return html;
        try {
          const applied = applyHtmlPolicy(html, { policy, iframeHosts, source: 'insertContent' });
          const placeholders = sanitizeRawHtmlPlaceholders(applied.html, {
            policy,
            iframeHosts,
            source: 'insertContent',
          });
          if (applied.removed.length || placeholders.removed.length)
            emitContentReport(editor, {
              source: 'insertContent',
              format: 'html',
              unsupported: [],
              unknownHtml: [],
              rawHtml: [],
              policyRemoved: [...applied.removed, ...placeholders.removed],
            });
          return placeholders.html;
        } catch {
          return html; // a throwing function policy must not break pasting
        }
      },
    },
  });
}

/**
 * Cleans one `rawHtml` payload under the editor's current policy (the choke point's unit of
 * work). String policies go through `applyHtmlPolicy`; a throwing function policy leaves the
 * payload verbatim (the script-less preview still bounds it). String-policy verdicts are cached
 * by payload (plus policy and hosts) in the guard storage, so repeats are free.
 */
export function cleanRawHtmlPayload(
  editor: Editor,
  html: string,
  options: { policy?: HtmlPolicy; iframeHosts?: string[]; source: ContentReport['source'] },
): PolicyVerdict {
  const { policy, iframeHosts, source } = options;
  if (typeof policy === 'function') {
    try {
      return { html: policy(html, { source }), removed: [] };
    } catch {
      return { html, removed: [] };
    }
  }
  const storage = storageOf(editor);
  const hostsKey = iframeHosts ? [...iframeHosts].join(',').toLowerCase() : '';
  const key = `${policy ?? 'sanitize'}\0${hostsKey}\0${html}`;
  const cached = storage?.policyVerdicts.get(key);
  if (cached) return cached;
  let verdict: PolicyVerdict;
  try {
    const applied = applyHtmlPolicy(html, { policy, iframeHosts, source });
    // A payload can carry placeholders of its own; their values are policy inputs too.
    const nested = sanitizeRawHtmlPlaceholders(applied.html, { policy, iframeHosts, source });
    verdict = { html: nested.html, removed: [...applied.removed, ...nested.removed] };
  } catch {
    verdict = { html, removed: [] };
  }
  const cache = storage?.policyVerdicts;
  if (cache) {
    if (cache.size >= 1000) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, verdict);
  }
  return verdict;
}

/**
 * JSON loads never went through the HTML policy, so a stored `rawHtml.attrs.html` payload
 * is sanitized here like any other HTML input (unless the policy is `trusted`). Needed before
 * the parse for the initial load (no transaction runs at creation, so the choke point cannot
 * cover it) and kept on the other JSON paths for reporting accuracy (the removals land in the
 * load's own report); the choke point re-checks everything anyway. Untouched branches are
 * shared with the input; a payload the walk cannot process is left as-is (the choke point and
 * the script-less preview still bound it). Shared references resolve to one cleaned copy (N5).
 */
export function sanitizeRawHtmlJson(
  value: unknown,
  options: { policy?: HtmlPolicy; iframeHosts?: string[]; source: ContentReport['source'] },
): { value: unknown; removed: PolicyRemovedEntry[] } {
  if (options.policy === 'trusted') return { value, removed: [] };
  const removed: PolicyRemovedEntry[] = [];
  // Hostile input may be cyclic (visit each object once) or share one object twice (N5: the
  // second occurrence must resolve to the cleaned copy, not the unsanitized original).
  const seen = new Map<unknown, unknown>();
  const cleanPayload = (html: string): string => {
    try {
      const applied = applyHtmlPolicy(html, options);
      if (applied.removed.length) removed.push(...applied.removed);
      return applied.html;
    } catch {
      // A throwing function policy must not break the load (same call as in preserve.ts).
      return html;
    }
  };
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      if (seen.has(node)) return seen.get(node);
      seen.set(node, node); // cycles resolve to the original; replaced below when clean
      const out = node.map(walk);
      const result = out.some((item, i) => item !== node[i]) ? out : node;
      seen.set(node, result);
      return result;
    }
    if (typeof node !== 'object' || node === null) return node;
    if (seen.has(node)) return seen.get(node);
    seen.set(node, node);
    const record = node as Record<string, unknown>;
    let next: Record<string, unknown> | null = null;
    if (
      record.type === RAW_HTML &&
      typeof (record.attrs as { html?: unknown } | null | undefined)?.html === 'string'
    ) {
      const attrs = record.attrs as { html: string };
      const html = cleanPayload(attrs.html);
      if (html !== attrs.html) next = { ...record, attrs: { ...attrs, html } };
    }
    const content = (next ?? record).content;
    if (Array.isArray(content)) {
      const walked = walk(content);
      if (walked !== content) next = { ...(next ?? record), content: walked };
    }
    const result = next ?? node;
    seen.set(node, result);
    return result;
  };
  try {
    return { value: walk(value), removed };
  } catch {
    return { value, removed: [] };
  }
}

/**
 * Consumer hook, then the HTML security policy, then per-block `rawHtml` preservation.
 * A hook result that is still a string becomes `{ html }` (what tiptap parses, with the report
 * slices and the policy-applied input for `getLosslessHTML()`); a JSON hook result becomes
 * `{ json }` for the JSON guard below.
 */
function prepareHtml(
  editor: Editor,
  input: string,
  source: ContentReport['source'],
):
  | {
      html: string;
      rawHtml: ContentReport['rawHtml'];
      policyRemoved: ContentReport['policyRemoved'];
      losslessHtml: string;
    }
  | { json: unknown } {
  const hook = optionsOf(editor)?.preprocessHtml;
  const hooked = hook ? hook(input, { editor, source }) : input;
  if (typeof hooked !== 'string') return { json: hooked };
  const preserved = preserveHtmlForLoad(hooked, editor.schema, policyOf(editor, source));
  return {
    html: preserved.html,
    rawHtml: preserved.rawHtml,
    policyRemoved: preserved.policyRemoved,
    losslessHtml: preserved.policyHtml,
  };
}

const emptyReport = (source: ContentReport['source']): ContentReport => ({
  source,
  format: 'json',
  unsupported: [],
  unknownHtml: [],
  rawHtml: [],
  policyRemoved: [],
});

/** Guards content that replaces the whole document. */
function prepareDocument(
  editor: Editor,
  content: AnyContent,
  source: ContentReport['source'],
): Prepared {
  const report = emptyReport(source);
  let value: unknown = content;
  let losslessHtml: string | null = null;
  if (typeof value === 'string') {
    report.format = 'html';
    const prepared = prepareHtml(editor, value, source);
    // The preservation verified every top-level block (it ran and fell back to nothing),
    // so every element matched a schema rule and the scan below would report nothing.
    let preservationClean = false;
    if ('json' in prepared) value = prepared.json;
    else {
      value = prepared.html;
      report.rawHtml = prepared.rawHtml;
      report.policyRemoved = prepared.policyRemoved;
      losslessHtml = prepared.losslessHtml;
      preservationClean = prepared.rawHtml.length === 0 && !!editor.schema.nodes[RAW_HTML];
    }
    if (typeof value === 'string') {
      // Leftover elements the preservation could not wrap (normally empty now).
      report.unknownHtml = preservationClean ? [] : scanUnknownHtml(value, editor.schema);
      return { content: value, report, losslessHtml };
    }
  }
  if (!isJsonContent(value) || !hasGuardTypes(editor.schema))
    return { content: value as AnyContent, report, losslessHtml };
  // JSON input skips the HTML pipeline entirely: stored `rawHtml` payloads get the same
  // policy here, with the removals reported like an HTML load's.
  const sanitized = sanitizeRawHtmlJson(value, policyOf(editor, source));
  if (sanitized.removed.length) {
    value = sanitized.value;
    report.policyRemoved.push(...sanitized.removed);
  }
  try {
    const { doc, unsupported } = guardDocument(value, editor.schema);
    report.unsupported = unsupported;
    return { content: doc as unknown as AnyContent, report, losslessHtml };
  } catch (error) {
    goFatal(editor, report, value, error);
    return {
      content: fatalDocument(value, editor.schema) as unknown as AnyContent,
      report,
      losslessHtml: null,
    };
  }
}

/** Guards content inserted at `from` (HTML goes through policy + preservation, then parses). */
function prepareInsert(
  editor: Editor,
  content: AnyContent,
  from: number,
  docSize: number,
): Prepared {
  const report = emptyReport('insertContent');
  let value: unknown = content;
  if (typeof value === 'string') {
    report.format = 'html';
    const prepared = prepareHtml(editor, value, 'insertContent');
    // Same fast path as `prepareDocument`: verified blocks need no re-scan.
    let preservationClean = false;
    if ('json' in prepared) value = prepared.json;
    else {
      value = prepared.html;
      report.rawHtml = prepared.rawHtml;
      report.policyRemoved = prepared.policyRemoved;
      preservationClean = prepared.rawHtml.length === 0 && !!editor.schema.nodes[RAW_HTML];
    }
    if (typeof value === 'string') {
      report.unknownHtml = preservationClean ? [] : scanUnknownHtml(value, editor.schema);
      return { content: value, report, losslessHtml: null };
    }
  }
  if (!isJsonContent(value) || !hasGuardTypes(editor.schema))
    return { content: value as AnyContent, report, losslessHtml: null };
  // Same JSON gap as `prepareDocument`: inserted JSON `rawHtml` payloads get the policy.
  const sanitized = sanitizeRawHtmlJson(value, policyOf(editor, 'insertContent'));
  if (sanitized.removed.length) {
    value = sanitized.value;
    report.policyRemoved.push(...sanitized.removed);
  }
  const $pos = editor.state.doc.resolve(Math.max(0, Math.min(from, docSize)));
  const { content: guarded, unsupported } = guardFragment(
    value,
    editor.schema,
    $pos.parent.inlineContent,
  );
  report.unsupported = unsupported;
  return { content: guarded as unknown as AnyContent, report, losslessHtml: null };
}

/**
 * Lossless content guard. Before tiptap sees incoming JSON (initial content, `setContent`,
 * `insertContent(At)`), anything the schema cannot load is wrapped instead of making tiptap
 * replace the document with an empty paragraph: unknown nodes → `unsupportedNode` /
 * `unsupportedInline` (original JSON kept, visible placeholder), unknown marks and mark attributes
 * → `unsupportedMark`, unknown node attributes → `unsupportedAttrs`. `getLosslessJSON(editor)`
 * restores the originals. HTML input goes through the consumer `preprocessHtml` hook, then the
 * `htmlPolicy` security policy, then per-block `rawHtml` preservation: blocks the schema
 * cannot round-trip are kept verbatim instead of degraded, and reported in `rawHtml` (with
 * policy removals in `policyRemoved`). `unknownHtml` is what is still not preserved (normally
 * empty). `getLosslessHTML(editor)` returns the loaded HTML verbatim while the document is
 * unedited. Registers the holder nodes/mark.
 *
 * The guard is also the single policy choke point. A plugin (`appendTransaction`) finds
 * `rawHtml` nodes created or changed by any transaction whose `html` is not clean under the
 * editor's current policy (`htmlPolicyOf`), replaces it with the cleaned value in the appended
 * transaction, and reports the removals; paste/drop goes through a plugin `transformPastedHTML`
 * prop no `setOptions` can replace. Policy and `iframeHosts` live only in the guard options —
 * every other reader (`RawHtml` preview, preservation, source mode, fragment apply) reads them
 * from `htmlPolicyOf(editor)`.
 */
export const ContentGuard = Extension.create<ContentGuardOptions, ContentGuardStorage>({
  name: GUARD,

  addOptions() {
    return {
      onContentReport: null,
      preprocessHtml: null,
      htmlPolicy: null,
      iframeHosts: null,
      labels: {},
    };
  },

  addStorage() {
    return {
      lastReport: null,
      fatal: null,
      editableBeforeFatal: null,
      busy: false,
      lastInput: null,
      losslessHtml: null,
      losslessDoc: null,
      policyVerdicts: new Map(),
    };
  },

  addExtensions() {
    const labels = this.options.labels;
    return [
      UnsupportedNode.configure({ labels }),
      UnsupportedInline.configure({ labels }),
      UnsupportedMark,
    ];
  },

  addGlobalAttributes() {
    return [
      {
        types: 'nodes',
        attributes: {
          [UNSUPPORTED_ATTRS]: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el: HTMLElement) =>
              parseJsonAttribute(el.getAttribute('data-unsupported-attrs')),
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs[UNSUPPORTED_ATTRS]
                ? { 'data-unsupported-attrs': JSON.stringify(attrs[UNSUPPORTED_ATTRS]) }
                : {},
          },
        },
      },
    ];
  },

  onBeforeCreate() {
    const editor = this.editor;
    const content = editor.options.content;
    if (content === null || content === undefined) return;
    this.storage.lastInput = content;
    const { content: guarded, report, losslessHtml } = prepareDocument(editor, content, 'initial');
    editor.options.content = guarded as Content;
    // The initial document itself is captured by the `initialDocKey` plugin below.
    this.storage.losslessHtml = report.fatal ? null : losslessHtml;
    emitContentReport(editor, report);
  },

  addProseMirrorPlugins() {
    const key = new PluginKey<boolean>('rcmContentLoad');
    const storage = this.storage;
    const editor = this.editor as Editor;
    return [
      new Plugin({
        key: new PluginKey('rcmContentLock'),
        // Fatal: the document holds only the read-only holder of the original; nothing may
        // change it except the next load (which replaces it and leaves the fatal state).
        filterTransaction: (tr) =>
          !(tr.docChanged && storage.fatal && tr.getMeta(GUARD_REPLACE_META) !== true),
      }),
      new Plugin<boolean>({
        key,
        // true right after a whole-document load through the guard's setContent
        state: { init: () => false, apply: (tr) => tr.getMeta(CONTENT_LOAD_META) === true },
        // A load must give back what came in: prosemirror-tables' fixTables would rewrite the
        // loaded tables (fill colwidth, add/remove cells, delete "zero-sized" tables) in a
        // transaction appended to setContent. Initial content is not normalised either; later
        // edits of a table still are.
        filterTransaction: (tr, state) => !(tr.getMeta(fixTablesKey) && key.getState(state)),
      }),
      new Plugin<PMNode | null>({
        key: initialDocKey,
        // The initial document, captured once when the state is created and never updated:
        // `setContent` loads record their own document in storage instead.
        state: { init: (_config, state) => state.doc, apply: (_tr, value) => value },
      }),
      pastePolicyPlugin(editor),
      policyChokePlugin(editor),
    ];
  },

  addCommands() {
    return {
      setContent:
        (content, options = {}) =>
        (props) => {
          const { editor } = props;
          // Dry run (`can()`): replacing the document is always possible; no guard side effects.
          if (!props.dispatch) return true;
          const storage = storageOf(editor);
          if (storage) storage.lastInput = content;
          const {
            content: guarded,
            report,
            losslessHtml,
          } = prepareDocument(editor, content, 'setContent');
          if (!report.fatal) recover(editor);
          if (storage) storage.busy = true;
          props.tr.setMeta(CONTENT_LOAD_META, true);
          props.tr.setMeta(GUARD_REPLACE_META, true);
          try {
            const ok = coreCommands.setContent(guarded, {
              ...options,
              // HTML: tiptap's strict check rejects every element without a rule (`<div>`);
              // unknown elements are wrapped as `rawHtml` by the preservation above instead.
              ...(typeof guarded === 'string' ? { errorOnInvalidContent: false } : {}),
            })(props);
            if (storage) {
              storage.losslessHtml = report.fatal || !ok ? null : losslessHtml;
              storage.losslessDoc = storage.losslessHtml !== null ? editor.state.doc : null;
            }
            emitContentReport(editor, report);
            return ok;
          } finally {
            if (storage) storage.busy = false;
          }
        },
      insertContentAt:
        (position, content, options = {}) =>
        (props) => {
          const { editor, tr } = props;
          const storage = storageOf(editor);
          if (storage?.fatal && !storage.busy) return false;
          if (storage?.busy)
            return coreCommands.insertContentAt(position, content, {
              ...options,
              ...(typeof content === 'string' ? { errorOnInvalidContent: false } : {}),
            })(props);
          const from = typeof position === 'number' ? position : position.from;
          const { content: guarded, report } = prepareInsert(
            editor,
            content,
            from,
            tr.doc.content.size,
          );
          const ok = coreCommands.insertContentAt(position, guarded, {
            ...options,
            ...(typeof guarded === 'string' ? { errorOnInvalidContent: false } : {}),
          })(props);
          if (props.dispatch) emitContentReport(editor, report);
          return ok;
        },
    };
  },
});

/**
 * `editor.getJSON()` with everything the guard wrapped restored to the original JSON (unknown
 * nodes, marks and attributes). After a guard failure, the original content as given.
 * Without the guard extension this is `editor.getJSON()`.
 */
export function getLosslessJSON(editor: Editor): JSONContent {
  const fatal = storageOf(editor)?.fatal;
  if (fatal && typeof fatal.original === 'object' && fatal.original !== null)
    return fatal.original as JSONContent;
  return unwrapUnsupported(editor.getJSON());
}

/** The last content report of `editor` (null before any content came in or without the guard). */
export function getContentReport(editor: Editor): ContentReport | null {
  return storageOf(editor)?.lastReport ?? null;
}

/**
 * The editor's configured HTML policy inputs (guard options; creation-time config). Used by
 * the React source mode so fragment applies and in-source payloads follow exactly the
 * policy the editor loads with.
 */
export function htmlPolicyOf(editor: Editor): { policy?: HtmlPolicy; iframeHosts?: string[] } {
  const options = optionsOf(editor);
  if (!options) return {};
  return {
    policy: options.htmlPolicy ?? undefined,
    iframeHosts: options.iframeHosts ?? undefined,
  };
}

/**
 * The loaded HTML verbatim when the document is still the one the last HTML load produced
 * (`doc.eq`, so edits made and undone count as unedited), otherwise null. Without the guard
 * extension this is always null.
 */
export function peekLosslessHtml(editor: Editor): string | null {
  const storage = storageOf(editor);
  if (!storage || storage.losslessHtml == null) return null;
  const doc = editor.state.doc;
  // A `setContent` HTML load records its document; the initial load compares against the
  // document the state was created with (tracked by a plugin: synchronous, mount-independent).
  const loaded = storage.losslessDoc ?? initialDocKey.getState(editor.state) ?? null;
  if (loaded && doc.eq(loaded)) return storage.losslessHtml;
  return null;
}

/**
 * HTML for saving (`onChange().html`, vanilla `getHTML()`). When the document is still the one
 * the last HTML load produced (`doc.eq`, so edits made and undone count as unedited), this is
 * the loaded HTML verbatim — policy applied, `rawHtml` blocks byte-identical, no serializer
 * normalization. Otherwise (edited, or loaded from JSON) it is `editor.getHTML()`, in which
 * `rawHtml` blocks still render verbatim. Without the guard extension this is `editor.getHTML()`.
 */
export function getLosslessHTML(editor: Editor): string {
  return peekLosslessHtml(editor) ?? editor.getHTML();
}

/**
 * tiptap `onContentError` handler (last-resort net with `enableContentCheck: true`): content
 * that reached tiptap's own check unguarded. HTML errors are reported as unknown HTML (tiptap
 * keeps its lenient parse); anything else makes the editor read-only, keeps the original content
 * for `getLosslessJSON()` and reports `fatal`. Never throws.
 */
export function handleContentError({ editor, error }: { editor: Editor; error: Error }): void {
  const html = /Invalid HTML content/.test(error.message);
  // The guard already scanned this HTML (beforeCreate / setContent): nothing new to report.
  if (html && storageOf(editor)?.lastReport?.format === 'html') return;
  const report: ContentReport = {
    source: 'initial',
    format: html ? 'html' : 'json',
    unsupported: [],
    unknownHtml: [],
    rawHtml: [],
    policyRemoved: [],
  };
  if (html) {
    const cause = (error as Error & { cause?: unknown }).cause;
    report.unknownHtml = [
      {
        tag: '?',
        html: cause instanceof Error ? cause.message.slice(0, 200) : '',
        reason: 'no-rule',
      },
    ];
  } else {
    goFatal(editor, report, storageOf(editor)?.lastInput ?? editor.options.content, error);
  }
  emitContentReport(editor, report);
}

/** Editor options enabling tiptap's content check with `handleContentError` as the net. */
export function contentGuardEditorOptions(): Pick<
  EditorOptions,
  'enableContentCheck' | 'onContentError'
> {
  return { enableContentCheck: true, onContentError: handleContentError };
}
