import type { JSONContent } from '@tiptap/core';
import { createDocparserAssetResolver } from './assets';
import { DocparserImportError } from './errors';
import type {
  DocparserAssetResolver,
  DocparserRangeDoc,
  DocparserResponse,
  DocparserWarning,
} from './types';

export type DocparserSeparator =
  | 'pageBreak'
  | 'horizontalRule'
  | 'none'
  /** Blocks placed before range `index` (1-based among the joins: called for index 1…n-1). */
  | ((index: number) => JSONContent[]);

export interface FromDocparserOptions {
  /** `docs[]` handling: join the ranges (default) or pick one (`index`). */
  ranges?: 'concat' | 'select';
  /** Between ranges when concatenating (default `'pageBreak'`). */
  separator?: DocparserSeparator;
  /** Range to take with `ranges: 'select'` (default 0). */
  index?: number;
  /**
   * Register the response's assets in this resolver instead of a new one (merging several
   * responses). `dispose()` of the result then leaves it alone: its owner disposes it.
   */
  resolver?: DocparserAssetResolver;
}

export interface DocparserRangeInfo {
  index: number;
  /** `title` of the `docs[i]` wrapper, when the response carries one. */
  title?: string;
}

export interface FromDocparserResult {
  /** A tiptap `doc`, ready for `setContent` / `<RcmEditor value>`. Never shares objects with the input. */
  content: JSONContent;
  /** The editor's `resolveAsset` for this response's images. */
  resolveAsset: DocparserAssetResolver;
  /** Revoke the blob URLs this result created. Idempotent. */
  dispose(): void;
  warnings: DocparserWarning[];
  /** One entry per `docs[]` item (a single `doc` response has one entry). */
  ranges: DocparserRangeInfo[];
  renderRevision?: string;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function copy<T>(value: T, what: string): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    throw new DocparserImportError('invalid_doc', `${what} is not plain JSON`);
  }
}

function checkDoc(value: unknown, where: string): JSONContent {
  if (!isObject(value) || value.type !== 'doc')
    throw new DocparserImportError('invalid_doc', `${where} is not a tiptap doc node`);
  const content = value.content;
  if (content !== undefined && !Array.isArray(content))
    throw new DocparserImportError('invalid_doc', `${where}.content must be an array`);
  (content as unknown[] | undefined)?.forEach((child, i) => {
    if (!isObject(child) || typeof child.type !== 'string')
      throw new DocparserImportError('invalid_doc', `${where}.content[${i}] is not a node`);
  });
  return copy(value as JSONContent, where);
}

function unwrap(item: unknown, where: string): { doc: JSONContent; title?: string } {
  if (isObject(item) && item.type === undefined && 'doc' in item) {
    const title = typeof item.title === 'string' ? item.title : undefined;
    return { doc: checkDoc(item.doc, `${where}.doc`), ...(title !== undefined ? { title } : {}) };
  }
  return { doc: checkDoc(item, where) };
}

function checkWarnings(value: unknown): DocparserWarning[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value))
    throw new DocparserImportError('invalid_response', 'warnings must be an array');
  value.forEach((w, i) => {
    if (!isObject(w) || typeof w.code !== 'string')
      throw new DocparserImportError('invalid_response', `warnings[${i}] needs a string code`);
  });
  return copy(value as DocparserWarning[], 'warnings');
}

function separatorBlocks(separator: DocparserSeparator, index: number): JSONContent[] {
  if (typeof separator === 'function') {
    const out = separator(index);
    if (!Array.isArray(out) || out.some((n) => !isObject(n) || typeof n.type !== 'string'))
      throw new DocparserImportError('invalid_option', 'separator() must return node objects');
    return copy(out, 'separator()');
  }
  if (separator === 'pageBreak') return [{ type: 'pageBreak' }];
  if (separator === 'horizontalRule') return [{ type: 'horizontalRule' }];
  if (separator === 'none') return [];
  throw new DocparserImportError('invalid_option', `unknown separator ${String(separator)}`);
}

/**
 * Joins range documents. Ranged renders put the footnotes a range referenced at the end of that
 * range's doc (ids are document-wide), so the trailing `footnotes` blocks are merged into one at
 * the end of the result (duplicate ids dropped).
 */
function concat(docs: JSONContent[], separator: DocparserSeparator): JSONContent {
  const blocks: JSONContent[] = [];
  const footnotes: JSONContent[] = [];
  const seen = new Set<unknown>();
  docs.forEach((doc, i) => {
    if (i > 0) blocks.push(...separatorBlocks(separator, i));
    const content = [...(doc.content ?? [])];
    const last = content[content.length - 1];
    if (last?.type === 'footnotes') {
      content.pop();
      for (const note of last.content ?? []) {
        const id = note.attrs?.id;
        if (id !== undefined && seen.has(id)) continue;
        seen.add(id);
        footnotes.push(note);
      }
    }
    blocks.push(...content);
  });
  if (footnotes.length) blocks.push({ type: 'footnotes', content: footnotes });
  return { type: 'doc', content: blocks };
}

/**
 * Turns a docparser render response into editor content plus an asset resolver.
 *
 * `res` is the `documents:render` body (or the library result): `{doc}` or `{docs}`, with
 * optional `assets`, `warnings`, `render_revision`. The input is validated defensively
 * (`DocparserImportError` with a `code`) and never mutated.
 */
export function fromDocparser(
  res: DocparserResponse,
  options: FromDocparserOptions = {},
): FromDocparserResult {
  if (!isObject(res as unknown))
    throw new DocparserImportError('invalid_response', 'response is not an object');
  const hasDoc = res.doc !== undefined && res.doc !== null;
  const hasDocs = res.docs !== undefined && res.docs !== null;
  if (hasDoc === hasDocs)
    throw new DocparserImportError(
      'invalid_response',
      hasDoc ? 'response has both doc and docs' : 'response has neither doc nor docs',
    );
  const { ranges: mode = 'concat', separator = 'pageBreak', index } = options;
  if (mode !== 'concat' && mode !== 'select')
    throw new DocparserImportError('invalid_option', `unknown ranges mode ${String(mode)}`);
  if (res.render_revision !== undefined && typeof res.render_revision !== 'string')
    throw new DocparserImportError('invalid_response', 'render_revision must be a string');

  const entries: { doc: JSONContent; title?: string }[] = [];
  if (hasDoc) {
    entries.push({ doc: checkDoc(res.doc, 'doc') });
  } else {
    if (!Array.isArray(res.docs))
      throw new DocparserImportError('invalid_response', 'docs must be an array');
    (res.docs as DocparserRangeDoc[]).forEach((item, i) =>
      entries.push(unwrap(item, `docs[${i}]`)),
    );
    if (!entries.length) throw new DocparserImportError('invalid_response', 'docs is empty');
  }
  const warnings = checkWarnings(res.warnings);
  const infos: DocparserRangeInfo[] = entries.map((e, i) => ({
    index: i,
    ...(e.title !== undefined ? { title: e.title } : {}),
  }));

  let content: JSONContent;
  if (entries.length === 1 && hasDoc) {
    content = entries[0]!.doc;
  } else if (mode === 'select') {
    const at = index ?? 0;
    if (!Number.isInteger(at))
      throw new DocparserImportError('invalid_option', 'index must be an integer');
    if (at < 0 || at >= entries.length)
      throw new DocparserImportError(
        'range_out_of_bounds',
        `index ${at} is outside 0..${entries.length - 1}`,
      );
    content = entries[at]!.doc;
  } else {
    content = concat(
      entries.map((e) => e.doc),
      separator,
    );
  }

  const resolver = options.resolver ?? createDocparserAssetResolver();
  // Register after the content checks above so a bad response leaves a shared resolver untouched.
  const ownResolver = !options.resolver;
  try {
    resolver.add((res as DocparserResponse).assets);
  } catch (error) {
    if (ownResolver) resolver.dispose();
    throw error;
  }

  let disposed = false;
  return {
    content,
    resolveAsset: resolver,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (ownResolver) resolver.dispose();
    },
    warnings,
    ranges: infos,
    ...(res.render_revision !== undefined ? { renderRevision: res.render_revision } : {}),
  };
}
