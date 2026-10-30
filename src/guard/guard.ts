// Lossless content guard: wraps what the schema cannot load instead of letting tiptap
// replace the whole document with an empty paragraph.
import { elementFromString } from '@tiptap/core';
import { DOMParser, Fragment, Mark as PMMark, Schema } from '@tiptap/pm/model';
import type {
  ContentMatch,
  Mark,
  MarkSpec,
  MarkType,
  Node as PMNode,
  NodeSpec,
  NodeType,
  ParseRule,
  TagParseRule,
} from '@tiptap/pm/model';
import { stableStringify, typeLabel } from '../diagnostics/normalize';
import { isWhitespaceOnlySpan } from '../extensions/htmlFidelity';
import {
  UNSUPPORTED_ATTRS,
  UNSUPPORTED_INLINE,
  UNSUPPORTED_MARK,
  UNSUPPORTED_NODE,
} from './unsupported';
import type { UnsupportedMarkJson } from './unsupported';
import type { PolicyRemovedEntry } from '../html/policy';
import type { RawHtmlEntry } from '../html/preserve';

/**
 * - `node`: unknown block node type → `unsupportedNode`;
 * - `inline`: unknown node inside inline content → `unsupportedInline`;
 * - `mark`: unknown/invalid mark → kept on the text inside `unsupportedMark`;
 * - `attrs`: attributes the type does not define → kept in `unsupportedAttrs` / `unsupportedMark`;
 * - `keys`: node keys other than `type`/`attrs`/`content`/`marks`/`text` (e.g. `id`) → kept in
 *   `unsupportedAttrs` (text nodes: `unsupportedMark`), restored onto the node;
 * - `invalid`: a known node whose attributes or content the schema rejects → wrapped whole;
 * - `misplaced`: a valid node in a parent that does not allow it → held alone (`unsupportedNode` /
 *   `unsupportedInline`), the parent and its other children stay editable;
 * - `remapped`: a valid node in a parent that does not allow it, loaded in an editable form
 *   (block `image` in text → `inlineImage`; inline content in a block container → `paragraph`;
 *   `listItem`/`taskItem` outside a list → `bulletList`/`taskList`); `getLosslessJSON()` gives
 *   the original back;
 * - `filled`: a known node whose content needed required children added (nothing removed).
 */
export type UnsupportedKind =
  'node' | 'inline' | 'mark' | 'attrs' | 'keys' | 'invalid' | 'misplaced' | 'remapped' | 'filled';

export interface UnsupportedEntry {
  kind: UnsupportedKind;
  /** Original node or mark type (`?` when the item has none). */
  type: string;
  /** Path in the input JSON, e.g. `content[2](table).content[0](tableRow)`. */
  path: string;
  /** Short reason (error message or the unknown attribute names). */
  reason: string;
}

/**
 * An HTML element no parse rule of the schema matches. tiptap's parser keeps its children (text)
 * but not the element itself (`no-rule`), or drops it with its content (`ignored`: script, style,
 * …). turns these into `rawHtml` blocks.
 */
export interface UnknownHtmlEntry {
  tag: string;
  /** Element outerHTML, truncated to 200 characters. */
  html: string;
  reason: 'no-rule' | 'ignored';
}

export interface ContentReport {
  /** Where the content came in. */
  source: 'initial' | 'setContent' | 'insertContent';
  format: 'json' | 'html';
  unsupported: UnsupportedEntry[];
  unknownHtml: UnknownHtmlEntry[];
  /**
   * Top-level HTML blocks the schema could not round-trip, kept verbatim as `rawHtml`.
   * `html` is truncated for reports; the node holds the full source block.
   */
  rawHtml: RawHtmlEntry[];
  /** What the HTML security policy removed (nothing is removed silently). */
  policyRemoved: PolicyRemovedEntry[];
  /** Set when the guard could not load the content: the editor is read-only, original kept. */
  fatal?: { message: string };
}

export function isReportEmpty(report: ContentReport): boolean {
  return (
    !report.unsupported.length &&
    !report.unknownHtml.length &&
    !report.rawHtml.length &&
    !report.policyRemoved.length &&
    !report.fatal
  );
}

type JsonObject = Record<string, unknown>;
const isObject = (v: unknown): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep copy of plain JSON data (the editor must not share objects with the caller). */
export function cloneJson<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** True when the schema carries the guard's holder types. */
export function hasGuardTypes(schema: Schema): boolean {
  return !!(schema.nodes[UNSUPPORTED_NODE] && schema.nodes[UNSUPPORTED_INLINE]);
}

/** `unsupportedAttrs` key of unknown node keys (`id`, `meta`, …). */
const KEYS_KEY = '__rcmKeys';
/** `unsupportedAttrs` key of a remapped node's record (`RemapRecord`). */
const REMAP_KEY = '__rcmRemap';
const GUARD_KEYS = new Set([KEYS_KEY, REMAP_KEY]);

/**
 * How a misplaced node was loaded: `retype` (same attributes, other type) or `unwrap` (wrapped
 * in a container). `original` is the input; `check` the fingerprint of the remapped node as
 * loaded — while it matches, unwrapping gives `original` back byte for byte.
 */
interface RemapRecord {
  mode: 'retype' | 'unwrap';
  type?: string;
  original: unknown;
  check: string;
}

/** JSON without the guard's own `unsupportedAttrs` (at any depth). */
function withoutHeld(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutHeld);
  if (!isObject(value)) return value;
  const out: JsonObject = {};
  for (const [key, v] of Object.entries(value)) {
    if (key === 'attrs' && isObject(v)) {
      const { [UNSUPPORTED_ATTRS]: _held, ...rest } = v;
      out[key] = withoutHeld(rest);
    } else out[key] = withoutHeld(v);
  }
  return out;
}

/** Short content hash (FNV-1a) of a node's JSON, ignoring `unsupportedAttrs`. */
function fingerprint(json: unknown): string {
  const text = stableStringify(withoutHeld(json));
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16)}:${text.length}`;
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
const join = (path: string, key: string) => (path ? `${path}.${key}` : key);

/** A child as built, with its original JSON and the report entries from inside it. */
interface Kid {
  node: PMNode;
  raw: unknown;
  path: string;
  entries: UnsupportedEntry[];
}

/** Known node keys; anything else on a node object is kept under `KEYS_KEY`. */
const NODE_KEYS = new Set(['type', 'attrs', 'content', 'marks', 'text']);

function extraKeys(json: JsonObject): JsonObject | null {
  let out: JsonObject | null = null;
  for (const [key, value] of Object.entries(json))
    if (!NODE_KEYS.has(key)) (out ??= {})[key] = cloneJson(value);
  return out;
}

/** Paths of top-level items: `[i](type)` in an array, empty for a single node. */
const itemPath = (json: unknown) => (i: number, raw: unknown) =>
  Array.isArray(json) ? `[${i}]${typeLabel(raw)}` : '';

const typeOf = (json: unknown) =>
  isObject(json) && typeof json.type === 'string' ? json.type : '?';

class JsonGuard {
  readonly entries: UnsupportedEntry[] = [];
  private readonly blockHolder: NodeType;
  private readonly inlineHolder: NodeType;
  private readonly markHolder: MarkType | undefined;

  constructor(private readonly schema: Schema) {
    this.blockHolder = schema.nodes[UNSUPPORTED_NODE]!;
    this.inlineHolder = schema.nodes[UNSUPPORTED_INLINE]!;
    this.markHolder = schema.marks[UNSUPPORTED_MARK];
  }

  private wrap(
    json: unknown,
    path: string,
    inline: boolean,
    kind: UnsupportedKind,
    reason: string,
  ) {
    this.entries.push({
      kind: kind === 'invalid' ? 'invalid' : inline ? 'inline' : 'node',
      type: typeOf(json),
      path,
      reason,
    });
    return (inline ? this.inlineHolder : this.blockHolder).create({ json: cloneJson(json) });
  }

  /** Splits `given` into attributes the spec defines and the rest. */
  private splitAttrs(spec: Record<string, unknown>, given: unknown) {
    const known: JsonObject = {};
    let extra: JsonObject | null = null;
    if (isObject(given)) {
      for (const [key, value] of Object.entries(given)) {
        if (key in spec) known[key] = value;
        else (extra ??= {})[key] = value;
      }
    }
    return { known, extra };
  }

  private validateAttrs(type: NodeType | MarkType, attrs: JsonObject): void {
    for (const [name, attr] of Object.entries(type.spec.attrs ?? {})) {
      const validate = (attr as { validate?: unknown }).validate;
      if (typeof validate === 'function') (validate as (v: unknown) => void)(attrs[name]);
    }
  }

  /** `keys`: unknown keys of a text node, kept in the `unsupportedMark` holder. */
  private marks(list: unknown, path: string, keys: JsonObject | null): Mark[] {
    // Marks saved with getJSON() carry an `unsupportedMark`: back to the originals first.
    const restored =
      list === undefined || list === null
        ? { marks: [], keys: null }
        : restoreMarks(Array.isArray(list) ? list : [list]);
    const items = restored.marks;
    if (restored.keys) keys = { ...restored.keys, ...(keys ?? {}) };
    let set: readonly Mark[] = PMMark.none;
    const unknown: UnsupportedMarkJson['marks'] = [];
    const extras: UnsupportedMarkJson['attrs'] = {};
    items.forEach((raw, index) => {
      const markPath = join(path, `marks[${index}]${typeLabel(raw)}`);
      const markType =
        isObject(raw) && typeof raw.type === 'string' ? this.schema.marks[raw.type] : undefined;
      const keep = (reason: string) => {
        unknown.push({ index, mark: cloneJson(raw) });
        this.entries.push({ kind: 'mark', type: typeOf(raw), path: markPath, reason });
      };
      if (!markType || markType === this.markHolder) return keep('unknown mark type');
      const { known, extra } = this.splitAttrs(
        markType.spec.attrs ?? {},
        (raw as JsonObject).attrs,
      );
      let mark: Mark;
      try {
        mark = markType.create(known);
        this.validateAttrs(markType, mark.attrs as JsonObject);
      } catch (e) {
        return keep(errorMessage(e));
      }
      if (set.some((m) => m.type.excludes(markType) || markType.excludes(m.type)))
        return keep('excluded by another mark on the same node');
      set = mark.addToSet(set);
      if (extra) {
        extras[markType.name] = cloneJson(extra);
        this.entries.push({
          kind: 'attrs',
          type: markType.name,
          path: markPath,
          reason: Object.keys(extra).join(','),
        });
      }
    });
    if (unknown.length || Object.keys(extras).length || keys) {
      if (!this.markHolder) throw new Error('unsupported marks without the unsupportedMark type');
      const json: UnsupportedMarkJson = { marks: unknown, attrs: extras };
      if (keys) json.keys = keys;
      set = this.markHolder.create({ json }).addToSet(set);
    }
    return [...set];
  }

  node(json: unknown, path: string, inline: boolean): PMNode {
    if (!isObject(json) || typeof json.type !== 'string')
      return this.wrap(json, path, inline, 'invalid', 'not a node object');
    // A holder saved with getJSON(): load what it holds (wrapped again only if still unknown).
    if (json.type === UNSUPPORTED_NODE || json.type === UNSUPPORTED_INLINE) {
      const held = isObject(json.attrs) ? json.attrs : {};
      if (held.json !== undefined && held.json !== null && !held.fatal)
        return this.node(held.json, path, inline);
    }
    const type = this.schema.nodes[json.type];
    if (!type) return this.wrap(json, path, inline, 'node', 'unknown node type');
    const mark = this.entries.length;
    try {
      const keys = extraKeys(json);
      if (keys)
        this.entries.push({
          kind: 'keys',
          type: type.name,
          path,
          reason: Object.keys(keys).join(','),
        });
      const marks = this.marks(json.marks, path, type.isText ? keys : null);
      if (type.isText) {
        if (typeof json.text !== 'string' || json.text === '') throw new Error('empty text node');
        return this.schema.text(json.text, marks);
      }
      const known = this.nodeAttrs(type, json.attrs, keys, path);
      if (json.content !== undefined && json.content !== null && !Array.isArray(json.content))
        throw new Error('content is not an array');
      const kids = this.kids(
        (json.content as unknown[] | undefined) ?? [],
        (i, raw) => join(path, `content[${i}]${typeLabel(raw)}`),
        type,
      );
      const node = this.build(type, known, kids, marks, path);
      this.validateAttrs(type, node.attrs as JsonObject);
      return node;
    } catch (e) {
      // The whole original subtree is kept; reports from inside it are superseded.
      this.entries.length = mark;
      return this.wrap(json, path, inline, 'invalid', errorMessage(e));
    }
  }

  /**
   * Attributes of a node: the ones `type` defines, the rest in `unsupportedAttrs`. A saved
   * `unsupportedAttrs` (getJSON() output) is merged back first, so attributes the schema learned
   * in the meantime load as real attributes.
   */
  private nodeAttrs(type: NodeType, given: unknown, keys: JsonObject | null, path: string) {
    const spec = type.spec.attrs ?? {};
    let source: JsonObject = isObject(given) ? { ...given } : {};
    const saved = source[UNSUPPORTED_ATTRS];
    delete source[UNSUPPORTED_ATTRS];
    if (isObject(saved)) source = { ...saved, ...source };
    const { known, extra } = this.splitAttrs(spec, source);
    let held = extra;
    if (keys) {
      const prev = held?.[KEYS_KEY];
      held = { ...(held ?? {}), [KEYS_KEY]: { ...(isObject(prev) ? prev : {}), ...keys } };
    }
    if (held) {
      if (!(UNSUPPORTED_ATTRS in spec))
        throw new Error(`unsupported attributes ${Object.keys(held).join(',')}`);
      known[UNSUPPORTED_ATTRS] = cloneJson(held);
      const names = Object.keys(extra ?? {}).filter((k) => !GUARD_KEYS.has(k));
      if (names.length)
        this.entries.push({ kind: 'attrs', type: type.name, path, reason: names.join(',') });
    }
    return known;
  }

  /** Children of `parent`, each with its own report entries (so one can be replaced alone). */
  private kids(
    content: unknown[],
    pathOf: (i: number, raw: unknown) => string,
    parent: NodeType | null,
    inline = false,
  ): Kid[] {
    const inlineKids = parent ? parent.inlineContent : inline;
    return content.map((raw, i) => {
      const childPath = pathOf(i, raw);
      const before = this.entries.length;
      let node = this.node(raw, childPath, inlineKids);
      // (Inline nodes in a block container are wrapped or held by `repair`, which checks marks.)
      if (parent && (parent.inlineContent || !node.isInline) && !parent.allowsMarks(node.marks)) {
        // Marks this parent does not allow: keep that child whole rather than the parent.
        this.entries.length = before;
        node = this.wrap(raw, childPath, inlineKids, 'invalid', 'marks not allowed here');
      }
      return { node, raw, path: childPath, entries: this.entries.splice(before) };
    });
  }

  /**
   * `type` with `kids` as content. When the content does not fit, the children that do not fit
   * are fixed one by one (`repair`) before the parent gives up (throws → wrapped whole).
   */
  private build(
    type: NodeType,
    attrs: JsonObject | null,
    kids: Kid[],
    marks: readonly Mark[] | undefined,
    path: string,
  ): PMNode {
    const attempt = (list: Kid[]) => {
      const fragment = Fragment.fromArray(list.map((k) => k.node));
      if (type.validContent(fragment))
        return { node: type.create(attrs, fragment, marks), filled: false };
      const filled = type.createAndFill(attrs, fragment, marks);
      if (filled && type.validContent(filled.content)) return { node: filled, filled: true };
      return null;
    };
    let used = kids;
    let result = attempt(kids);
    if (!result) {
      const repaired = this.repair(type, kids);
      if (repaired) {
        result = attempt(repaired);
        used = repaired;
      }
    }
    if (!result) throw new Error(`invalid content for ${type.name}`);
    for (const kid of used) this.entries.push(...kid.entries);
    if (result.filled)
      this.entries.push({
        kind: 'filled',
        type: type.name,
        path,
        reason: 'required content added',
      });
    return result.node;
  }

  /**
   * Child-level fallback for content `type` rejects: children that fit stay as they are; a known
   * better form is used where one exists (`remapped`: block image in text → inlineImage, inline
   * content in a block container → paragraph, list items outside a list → bulletList/taskList);
   * anything else is held alone (`misplaced`). Null when even that does not fit.
   */
  private repair(type: NodeType, kids: Kid[]): Kid[] | null {
    let match: ContentMatch = type.contentMatch;
    const out: Kid[] = [];
    for (let i = 0; i < kids.length;) {
      const kid = kids[i]!;
      const direct = match.matchType(kid.node.type);
      if (direct) {
        out.push(kid);
        match = direct;
        i++;
        continue;
      }
      const run = this.wrapRun(type, match, kids, i);
      if (run) {
        out.push(run.kid);
        match = match.matchType(run.kid.node.type)!;
        i += run.count;
        continue;
      }
      const retyped = type.inlineContent ? this.retype(match, kid) : null;
      if (retyped) {
        out.push(retyped);
        match = match.matchType(retyped.node.type)!;
        i++;
        continue;
      }
      const holder = type.inlineContent ? this.inlineHolder : this.blockHolder;
      const next = match.matchType(holder);
      if (!next) return null;
      out.push({
        node: holder.create({ json: cloneJson(kid.raw) }),
        raw: kid.raw,
        path: kid.path,
        entries: [
          {
            kind: 'misplaced',
            type: typeOf(kid.raw),
            path: kid.path,
            reason: `${kid.node.type.name} is not allowed in ${type.name}`,
          },
        ],
      });
      match = next;
      i++;
    }
    return out;
  }

  /** Remap marker recording `original`, checked against the remapped node when unwrapping. */
  private remapped(node: PMNode, record: Omit<RemapRecord, 'check'>): PMNode {
    const saved = node.attrs[UNSUPPORTED_ATTRS] as JsonObject | null;
    const check = fingerprint(node.toJSON());
    return node.type.create(
      {
        ...node.attrs,
        [UNSUPPORTED_ATTRS]: { ...(saved ?? {}), [REMAP_KEY]: { ...record, check } },
      },
      node.content,
      node.marks,
    );
  }

  /** Consecutive children starting at `start` that fit `match` inside one wrapper node. */
  private wrapRun(parent: NodeType, match: ContentMatch, kids: Kid[], start: number) {
    const first = kids[start]!.node;
    const { nodes } = this.schema;
    let wrapper: NodeType | undefined;
    let belongs: (n: PMNode) => boolean;
    if (!parent.inlineContent && first.isInline) {
      wrapper = nodes.paragraph;
      belongs = (n) => n.isInline;
    } else if (first.type.name === 'listItem' || first.type.name === 'taskItem') {
      wrapper = nodes[first.type.name === 'listItem' ? 'bulletList' : 'taskList'];
      belongs = (n) => n.type === first.type;
    } else return null;
    if (!wrapper || !match.matchType(wrapper)) return null;
    let end = start;
    while (end < kids.length && belongs(kids[end]!.node)) end++;
    const run = kids.slice(start, end);
    const fragment = Fragment.fromArray(run.map((k) => k.node));
    if (!wrapper.validContent(fragment)) return null;
    if (wrapper.inlineContent && !run.every((k) => wrapper.allowsMarks(k.node.marks))) return null;
    const plain = wrapper.create(null, fragment);
    const node = this.remapped(plain, {
      mode: 'unwrap',
      original: cloneJson(run.map((k) => k.raw)),
    });
    const entries = run.flatMap((k) => k.entries);
    entries.push({
      kind: 'remapped',
      type: typeOf(run[0]!.raw),
      path: run[0]!.path,
      reason: `${run.length} × ${first.type.name} wrapped in ${wrapper.name}`,
    });
    return {
      kid: { node, raw: run.map((k) => k.raw), path: run[0]!.path, entries },
      count: run.length,
    };
  }

  /** A block `image` in inline content becomes an `inlineImage` with the same attributes. */
  private retype(match: ContentMatch, kid: Kid): Kid | null {
    const target = this.schema.nodes.inlineImage;
    if (kid.node.type.name !== 'image' || !target || !match.matchType(target)) return null;
    if (!isObject(kid.raw)) return null;
    const before = this.entries.length;
    const node = this.node({ ...kid.raw, type: target.name }, kid.path, true);
    const entries = this.entries.splice(before);
    if (node.type !== target) return null;
    entries.push({
      kind: 'remapped',
      type: 'image',
      path: kid.path,
      reason: `image in text kept as ${target.name}`,
    });
    return {
      node: this.remapped(node, { mode: 'retype', type: 'image', original: cloneJson(kid.raw) }),
      raw: kid.raw,
      path: kid.path,
      entries,
    };
  }

  /** A document node (`doc` JSON), or a node/array of nodes placed into a document. */
  document(json: unknown): PMNode {
    const top = this.schema.topNodeType;
    if (isObject(json) && json.type === top.name) {
      const node = this.node(json, '', false);
      if (node.type === top) return node;
      // The doc itself was rejected: keep it whole inside one holder.
      return top.create(null, node);
    }
    const kids = this.kids(Array.isArray(json) ? json : [json], itemPath(json), null, false);
    try {
      return this.build(top, null, kids, undefined, '');
    } catch {
      // Not even the child-level fallback fits: one holder per item keeps them all.
      for (const kid of kids) this.entries.push(...kid.entries);
      return top.create(
        null,
        kids.map((k) =>
          k.node.isBlock ? k.node : this.blockHolder.create({ json: cloneJson(k.raw) }),
        ),
      );
    }
  }

  items(json: unknown, inline: boolean): PMNode[] {
    const list = Array.isArray(json) ? json : [json];
    const kids = this.kids(list, itemPath(json), null, inline);
    for (const kid of kids) this.entries.push(...kid.entries);
    return kids.map((k) => k.node);
  }
}

export interface GuardedDocument {
  doc: PMNode;
  unsupported: UnsupportedEntry[];
}

/**
 * Builds a document from tiptap JSON without losing anything: unknown or invalid nodes become
 * `unsupportedNode`/`unsupportedInline` holding the original subtree, unknown marks and attributes
 * are kept in `unsupportedMark`/`unsupportedAttrs`. Requires the guard types in the schema
 * (`ContentGuard` extension). Throws only on non-JSON input (cyclic objects).
 */
export function guardDocument(json: unknown, schema: Schema): GuardedDocument {
  const guard = new JsonGuard(schema);
  const doc = guard.document(json);
  return { doc, unsupported: guard.entries };
}

/** Like `guardDocument` for content inserted into a parent (`inline` = parent has inline content). */
export function guardFragment(
  json: unknown,
  schema: Schema,
  inline: boolean,
): { content: PMNode | Fragment; unsupported: UnsupportedEntry[] } {
  const guard = new JsonGuard(schema);
  const items = guard.items(json, inline);
  return {
    content: Array.isArray(json) ? Fragment.fromArray(items) : items[0]!,
    unsupported: guard.entries,
  };
}

/** Document holding the whole original content in one read-only `fatal` holder. */
export function fatalDocument(original: unknown, schema: Schema): PMNode {
  let json: unknown;
  try {
    json = cloneJson(original);
  } catch {
    json = { type: '?', text: String(original) };
  }
  return schema.topNodeType.create(null, [
    schema.nodes[UNSUPPORTED_NODE]!.create({ json, fatal: true }),
  ]);
}

// --- HTML scan --------------------------------------------------------------------------------

/** Elements PM's DOMParser drops with their content (`ignoreTags` in prosemirror-model). */
const IGNORED_TAGS = new Set(['head', 'noscript', 'object', 'script', 'style', 'title']);
/** Structural elements the table/list rules read through (no information lost). */
const STRUCTURAL_TAGS = new Set(['html', 'body', 'tbody', 'thead', 'tfoot', 'colgroup', 'col']);
/** Attribute-less wrappers whose children are all that matters. */
const TRANSPARENT_TAGS = new Set(['span', 'div']);
const SNIPPET = 200;

type Sink = { found: HTMLElement[]; matched: WeakSet<HTMLElement> };
const scanSchemas = new WeakMap<Schema, { schema: Schema; sink: Sink }>();

type AnySpec = { parseDOM?: readonly ParseRule[] } & Record<string, unknown>;

/** Copies `spec` with every tag rule recording the elements it accepts in `sink.matched`. */
function recordingSpec<S extends AnySpec>(spec: S, sink: Sink): S {
  if (!spec.parseDOM) return spec;
  const parseDOM = spec.parseDOM.map((rule) => {
    if (!('tag' in rule) || !rule.tag) return rule;
    const tagRule = rule as TagParseRule;
    const original = tagRule.getAttrs;
    const staticAttrs = tagRule.attrs ?? null;
    return {
      ...tagRule,
      getAttrs: (el: HTMLElement) => {
        const result = original ? original(el) : staticAttrs;
        if (result !== false) sink.matched.add(el);
        return result;
      },
    };
  });
  return { ...spec, parseDOM };
}

function scanSchemaFor(schema: Schema) {
  let entry = scanSchemas.get(schema);
  if (!entry) {
    const sink: Sink = { found: [], matched: new WeakSet() };
    let nodes = schema.spec.nodes;
    nodes.forEach((name, spec) => {
      nodes = nodes.update(name, recordingSpec(spec as AnySpec, sink) as NodeSpec);
    });
    let marks = schema.spec.marks;
    marks.forEach((name, spec) => {
      marks = marks.update(name, recordingSpec(spec as AnySpec, sink) as MarkSpec);
    });
    // A catch-all *mark* rule at the lowest priority: it only sees elements no consuming rule took
    // (and, being a mark, does not change how the surrounding structure parses). Elements a
    // non-consuming rule accepted (textStyle spans) are not unknown.
    const scan = new Schema({
      topNode: schema.spec.topNode,
      nodes,
      marks: marks.append({
        __rcm_unknown_html__: {
          parseDOM: [
            {
              tag: '*',
              priority: 0,
              getAttrs: (el: HTMLElement) => {
                if (!sink.matched.has(el)) sink.found.push(el);
                return false;
              },
            },
          ],
        },
      }),
    });
    entry = { schema: scan, sink };
    scanSchemas.set(schema, entry);
  }
  return entry;
}

/**
 * Elements in `html` that the schema has no parse rule for (see `UnknownHtmlEntry`). Empty when
 * no DOM is available.
 */
export function scanUnknownHtml(html: string, schema: Schema): UnknownHtmlEntry[] {
  if (typeof window === 'undefined' || typeof document === 'undefined') return [];
  const { schema: scan, sink } = scanSchemaFor(schema);
  sink.found = [];
  sink.matched = new WeakSet();
  DOMParser.fromSchema(scan).parse(elementFromString(html), { preserveWhitespace: 'full' });
  const out: UnknownHtmlEntry[] = [];
  for (const el of sink.found) {
    const tag = el.nodeName.toLowerCase();
    if (STRUCTURAL_TAGS.has(tag)) continue;
    if (TRANSPARENT_TAGS.has(tag) && el.attributes.length === 0) continue;
    // `white-space` only: PM honours it while parsing (HtmlFidelity tab wrapper).
    if (isWhitespaceOnlySpan(el)) continue;
    const outer = el.outerHTML;
    out.push({
      tag,
      html: outer.length > SNIPPET ? `${outer.slice(0, SNIPPET)}…` : outer,
      reason: IGNORED_TAGS.has(tag) ? 'ignored' : 'no-rule',
    });
  }
  sink.found = [];
  return out;
}

// --- unwrap ----------------------------------------------------------------------------------

/**
 * Inverse of the guard on `getJSON()` output: `unsupportedNode`/`unsupportedInline` become their
 * original JSON, `unsupportedAttrs` merge back into `attrs` (unknown node keys back onto the
 * node), `unsupportedMark` restores the original marks and mark attributes, remapped nodes
 * (`remapped` report entries) return to their original form — exactly the input when unchanged,
 * otherwise with the edits in the original type/position. Recursive (holders saved inside
 * holders unwrap too). Returns a new object.
 */
export function unwrapUnsupported<T>(json: T): T {
  const out = unwrapList([json]);
  return (out.length === 1 ? out[0] : json) as T;
}

/** Unwraps a content array (a remapped wrapper becomes the items it was made from). */
function unwrapList(list: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const item of list) {
    const remap = remapOf(item);
    if (remap?.mode === 'unwrap' && Array.isArray(remap.original)) {
      const node = item as JsonObject;
      if (fingerprint(node) === remap.check) out.push(...unwrapList(cloneJson(remap.original)));
      else out.push(...unwrapList(Array.isArray(node.content) ? node.content : []));
      continue;
    }
    if (remap?.mode === 'retype') {
      if (fingerprint(item) === remap.check) out.push(...unwrapList([cloneJson(remap.original)]));
      else out.push({ ...(unwrapNode(item) as JsonObject), type: remap.type });
      continue;
    }
    out.push(unwrapNode(item));
  }
  return out;
}

function remapOf(value: unknown): RemapRecord | null {
  if (!isObject(value) || !isObject(value.attrs)) return null;
  const held = value.attrs[UNSUPPORTED_ATTRS];
  const remap = isObject(held) ? held[REMAP_KEY] : null;
  return isObject(remap) && typeof remap.check === 'string'
    ? (remap as unknown as RemapRecord)
    : null;
}

function unwrapNode(value: unknown): unknown {
  if (!isObject(value)) return value;
  if (value.type === UNSUPPORTED_NODE || value.type === UNSUPPORTED_INLINE) {
    const attrs = isObject(value.attrs) ? value.attrs : {};
    const held = cloneJson(attrs.json ?? null);
    const out = unwrapList([held]);
    return out.length === 1 ? out[0] : held;
  }
  let out: JsonObject = { ...value };
  if (isObject(out.attrs) && UNSUPPORTED_ATTRS in out.attrs) {
    const { [UNSUPPORTED_ATTRS]: extra, ...rest } = out.attrs;
    const held = flattenHeld(extra);
    const keys = held[KEYS_KEY];
    for (const k of GUARD_KEYS) delete held[k];
    out.attrs = { ...rest, ...held };
    if (isObject(keys)) out = { ...cloneJson(keys), ...out };
  }
  if (Array.isArray(out.marks)) {
    const restored = restoreMarks(out.marks);
    if (restored.marks.length || !out.marks.length) out.marks = restored.marks;
    else delete out.marks;
    if (restored.keys) out = { ...restored.keys, ...out };
  }
  if (Array.isArray(out.content)) out.content = unwrapList(out.content);
  return out;
}

/** `unsupportedAttrs` value as a plain object (nested ones from older saves merged in). */
function flattenHeld(extra: unknown): JsonObject {
  if (!isObject(extra)) return {};
  const { [UNSUPPORTED_ATTRS]: nested, ...rest } = cloneJson(extra);
  return nested === undefined ? rest : { ...flattenHeld(nested), ...rest };
}

/**
 * Marks with every `unsupportedMark` resolved to the marks/attributes it holds (repeatedly, for
 * holders saved inside holders), plus the unknown text-node keys it carried.
 */
function restoreMarks(marks: unknown[]): { marks: unknown[]; keys: JsonObject | null } {
  let list = marks;
  let keys: JsonObject | null = null;
  for (let depth = 0; depth < 32; depth++) {
    const holder = list.find((m) => isObject(m) && m.type === UNSUPPORTED_MARK) as
      JsonObject | undefined;
    if (!holder) break;
    const json = (isObject(holder.attrs) ? holder.attrs.json : null) as UnsupportedMarkJson | null;
    if (json?.keys && isObject(json.keys)) keys = { ...cloneJson(json.keys), ...(keys ?? {}) };
    const out: unknown[] = list
      .filter((m) => m !== holder)
      .map((m) => {
        if (!isObject(m) || !json?.attrs || typeof m.type !== 'string') return m;
        const extra = json.attrs[m.type];
        if (!extra) return m;
        return { ...m, attrs: { ...(isObject(m.attrs) ? m.attrs : {}), ...cloneJson(extra) } };
      });
    for (const { index, mark } of [...(json?.marks ?? [])].sort((a, b) => a.index - b.index))
      out.splice(Math.min(index, out.length), 0, cloneJson(mark));
    list = out;
  }
  return { marks: list, keys };
}
