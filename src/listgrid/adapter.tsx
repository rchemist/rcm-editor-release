'use client';

import { useCallback, useMemo, useRef } from 'react';
import type { FC, ReactNode } from 'react';
import { elementFromString } from '@tiptap/core';
import { DOMParser } from '@tiptap/pm/model';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { RcmEditor } from '@rchemist/editor/react';
import type { RcmEditorChange, RcmEditorProps } from '@rchemist/editor/react';
import { normalizeDoc, preserveHtmlForLoad, unwrapHtmlCodeBlocks } from '@rchemist/editor';

/**
 * listgrid `InputRendererProps`, declared structurally so the subpath works without
 * the listgrid package installed. Field-for-field compatible with listgrid's
 * `InputRendererProps` (`name`, `label?`, `errors?`, `required?`, `readonly?`,
 * `placeHolder?`, `attributes?`, `subCollectionEntity?`, `value?: any`,
 * `onChange(value, propagation?)`, `onError?`, `clearError?`, `regex?`).
 */
export interface RcmListgridInputProps {
  /** Field name (also rendered as `data-field-name` on the adapter root). */
  name: string;
  /** Label text/node (rendered by listgrid, not by the adapter). */
  label?: string | ReactNode | false;
  /** Validation messages (rendered by listgrid; the adapter only sets `aria-invalid`). */
  errors?: string[];
  required?: boolean;
  readonly?: boolean;
  placeHolder?: string;
  attributes?: Map<string, unknown>;
  subCollectionEntity?: boolean;
  /** HTML string; null/undefined/non-string/'' all mean the empty document. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value?: any;
  /** Called with the HTML string (or `''` for the empty document) and `false` — never JSON. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: (value: any, propagation?: boolean) => void;
  onError?: (message: string) => void;
  clearError?: () => void;
  regex?: { pattern: RegExp; message: string };
}

/**
 * Factory options: every `RcmEditor` prop except the listgrid-driven ones
 * (`value`/`defaultValue`/`onChange`/`readonly`), plus the legacy-unwrap switch.
 */
export type RcmListgridEditorOptions = Omit<
  Partial<RcmEditorProps>,
  'value' | 'defaultValue' | 'onChange' | 'readonly'
> & {
  /** Unwrap legacy `<pre><code class="language-html">` blocks on load (default `true`). */
  unwrapHtmlCodeBlocks?: boolean;
};

/** Minimal editor surface the adapter needs (structural: no tiptap instance import). */
interface ListgridEditorInstance {
  readonly schema: Schema;
  readonly state: { readonly doc: PMNode };
  readonly isDestroyed: boolean;
  getHTML(): string;
}

/** Non-string listgrid values all mean the empty document. */
function normalizeIncoming(value: unknown, unwrap: boolean): string {
  if (typeof value !== 'string' || value === '') return '';
  return unwrap ? unwrapHtmlCodeBlocks(value) : value;
}

/**
 * "Empty": the document is a single textblock whose content is blank. Unlike
 * `editor.isEmpty` (and a plain `textContent` check) this never treats a document containing
 * only an image, hr, table, rawHtml, pageBreak, … as empty — that content must round-trip.
 */
function isEmptyDocument(doc: PMNode): boolean {
  if (doc.childCount !== 1) return false;
  const first = doc.firstChild;
  if (!first || !first.isTextblock) return false;
  let empty = true;
  first.descendants((node) => {
    if (node.isText) {
      if ((node.text ?? '').trim() !== '') {
        empty = false;
        return false;
      }
      return true;
    }
    // A lone hard break is a line feed in an otherwise blank paragraph: still empty.
    // Every other atom/leaf (image, hr, rawHtml, pageBreak, …) carries content.
    if (node.type.name !== 'hardBreak') {
      empty = false;
      return false;
    }
    return true;
  });
  return empty;
}

/**
 * Semantic HTML equivalence: both strings go through the editor's own load path
 * (`preserveHtmlForLoad` → `elementFromString` + the schema `DOMParser`, i.e. what `setContent`
 * parses) and the shared `normalizeDoc` comparison, so attribute order, inter-block whitespace
 * and `<br>` vs `<br/>` never count as a change. Preservation runs with the `trusted` policy so
 * any difference inside non-schema markup (kept as `rawHtml` payloads) stays a difference: a
 * false "different" only reloads the content, a false "equivalent" would drop the new value.
 */
/** Attribute-order-insensitive serialization of a raw HTML fragment (DOM parse, sorted attrs). */
function canonicalRawHtml(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const element of template.content.querySelectorAll('*')) {
    const attributes = [...element.attributes].map((a) => [a.name, a.value] as const);
    for (const [attrName] of attributes) element.removeAttribute(attrName);
    attributes.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [attrName, attrValue] of attributes) element.setAttribute(attrName, attrValue);
  }
  return template.innerHTML.trim();
}

/** Canonicalizes every `rawHtml` payload in a doc JSON so only real markup changes differ. */
function canonicalizeRawPayloads(node: JSONLike): JSONLike {
  if (Array.isArray(node)) return node.map(canonicalizeRawPayloads);
  if (!node || typeof node !== 'object') return node;
  const out: { [key: string]: JSONLike } = {};
  for (const [key, child] of Object.entries(node)) out[key] = canonicalizeRawPayloads(child);
  const attrs = out.attrs as { [key: string]: JSONLike } | undefined;
  if (out.type === 'rawHtml' && attrs && typeof attrs.html === 'string') {
    out.attrs = { ...attrs, html: canonicalRawHtml(attrs.html) };
  }
  return out;
}

type JSONLike = null | boolean | number | string | JSONLike[] | { [key: string]: JSONLike };

function isEquivalentHtml(
  editor: ListgridEditorInstance,
  incoming: string,
  current: string,
): boolean {
  if (incoming === current) return true;
  if (typeof document === 'undefined') return false;
  try {
    const parser = DOMParser.fromSchema(editor.schema);
    const load = (html: string) =>
      parser.parse(
        elementFromString(
          preserveHtmlForLoad(html, editor.schema, { policy: 'trusted', source: 'setContent' })
            .html,
        ),
      );
    const parsedIncoming = load(incoming);
    const parsedCurrent = load(current);
    return (
      JSON.stringify(normalizeDoc(canonicalizeRawPayloads(parsedIncoming.toJSON()))) ===
      JSON.stringify(normalizeDoc(canonicalizeRawPayloads(parsedCurrent.toJSON())))
    );
  } catch {
    return false;
  }
}

/**
 * Creates a listgrid `MarkdownEditor` component (one stable component per factory call).
 * Consumers pass it to listgrid's `UIProvider` as `MarkdownEditor`.
 */
export function createListgridEditor(
  options: RcmListgridEditorOptions = {},
): FC<RcmListgridInputProps> {
  const {
    unwrapHtmlCodeBlocks: unwrap = true,
    className: consumerClassName,
    ...restOptions
  } = options;

  const RcmListgridEditor: FC<RcmListgridInputProps> = (props) => {
    const { name, readonly, placeHolder, errors, value, onChange } = props;
    const editorRef = useRef<ListgridEditorInstance | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const consumerReadyRef = useRef(restOptions.onReady);
    consumerReadyRef.current = restOptions.onReady;
    /** Last `{sent, html}` pair handed to the parent (echo detection). */
    const lastSentRef = useRef<{ sent: unknown; html: string } | null>(null);
    /** Exact `value` string last handed to `RcmEditor` (kept while equivalent). */
    const passedRef = useRef<string | null>(null);

    const incomingHtml = normalizeIncoming(value, unwrap);

    const handleReady = useCallback<NonNullable<RcmEditorProps['onReady']>>((editor) => {
      editorRef.current = editor;
      consumerReadyRef.current?.(editor);
    }, []);

    const handleChange = useCallback((change: RcmEditorChange) => {
      const editor = editorRef.current;
      // Read only `html` (never `json`); RcmEditor already debounced (100ms) and flushes on
      // blur/unmount, so no second debounce here.
      const html = change.html;
      const empty =
        editor && !editor.isDestroyed
          ? isEmptyDocument(editor.state.doc)
          : html === '' || html === '<p></p>';
      const out = empty ? '' : html;
      lastSentRef.current = { sent: out, html };
      onChangeRef.current(out, false);
    }, []);

    // Value handed to RcmEditor:
    // - `''` (or any value) echoed back by the parent maps to the html it came from, so
    //   `''` vs `'<p></p>'` never resets the document;
    // - a server-normalized but semantically equivalent HTML keeps the previously passed
    //   string, so cursor/selection/undo survive;
    // - anything genuinely different replaces the content (external value wins).
    const last = lastSentRef.current;
    let next: string;
    if (last && value === last.sent) {
      next = last.html;
    } else {
      next = incomingHtml;
      const editor = editorRef.current;
      const prev = passedRef.current;
      if (editor && !editor.isDestroyed && prev !== null && prev !== incomingHtml) {
        let current: string | null = null;
        try {
          current = editor.getHTML();
        } catch {
          current = null;
        }
        if (current !== null && isEquivalentHtml(editor, incomingHtml, current)) next = prev;
      }
    }
    passedRef.current = next;

    const features = useMemo(() => {
      if (placeHolder === undefined) return restOptions.features;
      const prev = restOptions.features?.emptyPlaceholder;
      return {
        ...restOptions.features,
        emptyPlaceholder: {
          ...(typeof prev === 'object' && prev !== null ? prev : {}),
          placeholder: placeHolder,
        },
      };
    }, [placeHolder]);

    const mergedEditorProps = useMemo(() => {
      const consumer = restOptions.editorProps;
      if (!errors || errors.length === 0) return consumer;
      const consumerAttributes = consumer?.attributes;
      return {
        ...consumer,
        attributes: (state: unknown) => ({
          ...(typeof consumerAttributes === 'function'
            ? (consumerAttributes as (s: unknown) => Record<string, string>)(state)
            : consumerAttributes),
          'aria-invalid': 'true',
        }),
      };
    }, [errors]);

    return (
      <div
        className={
          consumerClassName ? `rcm-listgrid-editor ${consumerClassName}` : 'rcm-listgrid-editor'
        }
        data-field-name={name}
      >
        <RcmEditor
          {...restOptions}
          value={next}
          readonly={readonly ?? false}
          onChange={handleChange}
          onReady={handleReady}
          minHeight={restOptions.minHeight ?? '20rem'}
          features={features}
          editorProps={mergedEditorProps}
        />
      </div>
    );
  };
  RcmListgridEditor.displayName = 'RcmListgridEditor';
  return RcmListgridEditor;
}

/** Default-configured adapter: `MarkdownEditor: RcmListgridEditor` in listgrid's `UIProvider`. */
export const RcmListgridEditor = createListgridEditor();
