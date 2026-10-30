// insertDocument: puts a docparser document's blocks into the editor at the cursor.
import { Extension } from '@tiptap/core';
import type { Editor, JSONContent } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { Fragment } from '@tiptap/pm/model';
import { EditorState, Selection } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import {
  CONTENT_LOAD_META,
  emitContentReport,
  htmlPolicyOf,
  isContentLocked,
  sanitizeRawHtmlJson,
} from '../guard/contentGuard';
import { guardFragment, hasGuardTypes } from '../guard/guard';
import type { ContentReport } from '../guard/guard';
import type { DocparserAsset } from '../docparser/types';
import { validateAsset } from '../docparser/assets';

/** A tiptap `doc` (its blocks are inserted), one block node, or an array of block nodes. */
export type InsertDocumentContent = JSONContent | JSONContent[];

export interface InsertDocumentOptions {
  /** Where to insert: the selection (default; a non-empty selection is replaced) or a document position. */
  at?: 'selection' | number;
  /**
   * docparser `assets[]` of the inserted document. They are added to the editor's asset
   * resolver (`features.image.resolveAsset` when it is a resolver with `add`, e.g. from
   * `createDocparserAssetResolver()`), before the images are rendered.
   */
  assets?: readonly DocparserAsset[];
}

export interface InsertDocumentExtensionOptions {
  [key: string]: never;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    insertDocument: {
      /**
       * Insert a document's blocks at the cursor, in one undo step. A paragraph under the cursor
       * is split (an empty one is replaced); unknown nodes in `content` are kept by the content
       * guard, and stored `rawHtml` payloads get the guard's HTML policy (reported through
       * `onContentReport`). Returns false (changing nothing) for empty or unusable content,
       * malformed `assets`, or while a content-guard failure locks the document.
       */
      insertDocument: (
        content: InsertDocumentContent,
        options?: InsertDocumentOptions,
      ) => ReturnType;
    };
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function toBlocks(content: unknown): JSONContent[] | null {
  const list = Array.isArray(content)
    ? content
    : isObject(content) && content.type === 'doc'
      ? ((content.content as unknown[] | undefined) ?? [])
      : [content];
  if (!list.every((n) => isObject(n) && typeof n.type === 'string')) return null;
  return list as JSONContent[];
}

type MergeableResolver = { add: (assets: readonly DocparserAsset[]) => void };

const hasAdd = (r: unknown): r is MergeableResolver =>
  typeof r === 'function' && typeof (r as { add?: unknown }).add === 'function';

/** True when `assets` is absent or a well-formed docparser `assets[]`. */
function validAssets(assets: unknown): boolean {
  if (assets === undefined) return true;
  if (!Array.isArray(assets)) return false;
  try {
    assets.forEach((asset, i) => validateAsset(asset, i));
    return true;
  } catch {
    return false;
  }
}

/** Adds `assets` to the asset resolvers of the image extensions that accept them. */
function mergeAssets(editor: Editor, assets: readonly DocparserAsset[] | undefined): void {
  if (!assets?.length) return;
  const seen = new Set<unknown>();
  for (const ext of editor.extensionManager.extensions) {
    if (ext.name !== 'image' && ext.name !== 'inlineImage') continue;
    const resolver = (ext.options as { resolveAsset?: unknown }).resolveAsset;
    if (seen.has(resolver) || !hasAdd(resolver)) continue;
    seen.add(resolver);
    resolver.add(assets);
  }
}

/** First position at or after `pos` (climbing out of ancestors) whose parent accepts `fragment`. */
function fittingPosition(tr: Transaction, pos: number, fragment: Fragment): number | null {
  let at = pos;
  for (;;) {
    const $at = tr.doc.resolve(at);
    if ($at.parent.canReplace($at.index(), $at.index(), fragment)) return at;
    if ($at.depth === 0) return null;
    at = $at.after();
  }
}

/** Places `fragment` at the block boundary nearest to `pos`, splitting/replacing the textblock there. */
function place(tr: Transaction, pos: number, fragment: Fragment): number | null {
  const $pos = tr.doc.resolve(pos);
  let insertAt = pos;
  if ($pos.parent.isTextblock) {
    const parent = $pos.parent;
    if (parent.content.size === 0) {
      // Replace an empty paragraph, unless that would leave the document ending in a block
      // the user cannot type after (table, figure, …).
      const last = fragment.lastChild;
      const container = $pos.node($pos.depth - 1);
      if (
        last?.isTextblock &&
        container.canReplace($pos.index($pos.depth - 1), $pos.indexAfter($pos.depth - 1), fragment)
      ) {
        tr.replaceWith($pos.before(), $pos.after(), fragment);
        return $pos.before() + fragment.size;
      }
      insertAt = $pos.before();
    } else if ($pos.parentOffset === 0) {
      insertAt = $pos.before();
    } else if ($pos.parentOffset === parent.content.size) {
      insertAt = $pos.after();
    } else {
      tr.split(pos);
      insertAt = pos + 1;
    }
  }
  const target = fittingPosition(tr, insertAt, fragment);
  if (target === null) return null;
  tr.insert(target, fragment);
  return target + fragment.size;
}

/**
 * `editor.commands.insertDocument(content, { at, assets })`: insert another document (e.g. a
 * ranged docparser render, `fromDocparser(...).content`) at the cursor. One undo step restores
 * the previous document exactly. Content goes through the content guard, so nodes the schema
 * does not know are kept as unsupported placeholders (reported through `onContentReport`).
 */
export const InsertDocument = Extension.create<InsertDocumentExtensionOptions>({
  name: 'insertDocument',

  addCommands() {
    return {
      insertDocument:
        (content, options = {}) =>
        ({ editor, tr, dispatch }) => {
          const blocks = toBlocks(content);
          if (!blocks || !blocks.length) return false;
          const { at = 'selection', assets } = options;
          // Refused before anything is touched: malformed assets, or a document locked by a
          // content-guard failure.
          if (!validAssets(assets) || isContentLocked(editor)) return false;
          if (at !== 'selection' && !(Number.isInteger(at) && at >= 0)) return false;
          if (typeof at === 'number' && at > tr.doc.content.size) return false;

          const report: ContentReport = {
            source: 'insertContent',
            format: 'json',
            unsupported: [],
            unknownHtml: [],
            rawHtml: [],
            policyRemoved: [],
          };
          let fragment: Fragment;
          try {
            if (hasGuardTypes(editor.schema)) {
              // Stored `rawHtml` payloads get the guard's policy before the fragment parses
              // (reporting accuracy — the removals land in this command's report; the
              // choke point re-checks everything the parse produces).
              const sanitized = sanitizeRawHtmlJson(blocks, {
                ...htmlPolicyOf(editor),
                source: 'insertContent',
              });
              if (sanitized.removed.length) report.policyRemoved.push(...sanitized.removed);
              const guarded = guardFragment(sanitized.value as JSONContent[], editor.schema, false);
              fragment = guarded.content as Fragment;
              report.unsupported = guarded.unsupported;
            } else {
              fragment = Fragment.fromArray(blocks.map((b) => editor.schema.nodeFromJSON(b)));
            }
          } catch {
            return false;
          }
          if (!dispatch) return true;

          const apply = (target: Transaction): number | null => {
            if (at === 'selection' && !target.selection.empty) target.deleteSelection();
            return place(target, at === 'selection' ? target.selection.from : at, fragment);
          };
          // A command's transaction is dispatched even when it returns false: prove the insert
          // fits on a scratch transaction before touching the real one.
          if (apply(EditorState.create({ doc: tr.doc, selection: tr.selection }).tr) === null)
            return false;
          // Assets go in before the transaction renders the images (and before it is touched:
          // a resolver that still rejects them leaves the document as it was).
          try {
            mergeAssets(editor, assets);
          } catch {
            return false;
          }
          const end = apply(tr);
          if (end === null) return false;

          // Same as a document load: inserted tables keep the values they came with.
          tr.setMeta(CONTENT_LOAD_META, true);
          // Its own undo step, even right after typing (history groups edits made within 500 ms).
          closeHistory(tr);
          tr.setSelection(Selection.near(tr.doc.resolve(Math.min(end, tr.doc.content.size)), -1));
          tr.scrollIntoView();
          emitContentReport(editor, report);
          return true;
        },
    };
  },
});
