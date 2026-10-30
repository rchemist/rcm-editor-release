// Per-block schema roundtrip preservation.
//
// After the policy, the HTML is split into top-level blocks. Each block is parsed with the
// editor schema and serialized back; when the result is not *equivalent* to the source block,
// the whole block is wrapped in a `rawHtml` placeholder (verbatim `outerHTML`) instead of being
// silently degraded. Equivalence:
// - element tree (tags, nesting, child counts),
// - attribute sets and values (exact, except `style`),
// - `style` declaration sets (whitespace/order/color notation normalized),
// - text with HTML whitespace rules applied (runs collapse to one space, and whitespace next to
//   a block boundary renders nothing — so pretty-printed indentation is not content; comments
//   still fail safe to `rawHtml`).
//
// Direction of error is always towards `rawHtml` (an uneditable but byte-identical block), never
// towards silent loss. The editor's own `getHTML()` output round-trips with zero `rawHtml` blocks.
import { elementFromString } from '@tiptap/core';
import { DOMParser as ProseMirrorParser, DOMSerializer } from '@tiptap/pm/model';
import type { Schema } from '@tiptap/pm/model';
import { patchHtmlSerializer } from '../extensions/htmlFidelity';
import { RAW_HTML, RAW_HTML_ATTR, rawHtmlPlaceholder } from '../extensions/rawHtml';
import { applyHtmlPolicy } from './policy';
import type { ApplyPolicyResult, HtmlPolicy, PolicyRemovedEntry } from './policy';

export type RawHtmlReason = 'element' | 'attribute' | 'style';

export interface RawHtmlEntry {
  /** Top-level position, e.g. `[2](div)`. */
  path: string;
  reason: RawHtmlReason;
  detail?: string;
  /** Verbatim source block (truncated for reports; the node holds the full string). */
  html: string;
}

export interface PreserveOptions {
  policy?: HtmlPolicy;
  iframeHosts?: string[];
  source: 'initial' | 'setContent' | 'insertContent';
}

export interface PreserveResult {
  /** What tiptap parses: policy output with non-equivalent blocks replaced by placeholders. */
  html: string;
  /** The policy result before preservation wrapping (what `getLosslessHTML` returns). */
  policyHtml: string;
  rawHtml: RawHtmlEntry[];
  policyRemoved: PolicyRemovedEntry[];
}

const SNIPPET = 200;
const snippet = (value: string): string =>
  value.length > SNIPPET ? `${value.slice(0, SNIPPET)}…` : value;

// --- style normalization ----------------------------------------------------------------------

function parseStyleDeclarations(style: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const decl of style.split(';')) {
    const colon = decl.indexOf(':');
    if (colon < 0) continue;
    const property = decl.slice(0, colon).trim().toLowerCase();
    if (!property) continue;
    out.set(property, normalizeCssValue(decl.slice(colon + 1)));
  }
  return out;
}

const RGB = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?\s*\)/gi;
const SHORT_HEX = /#([0-9a-f])([0-9a-f])([0-9a-f])(?![0-9a-f])/gi;

function toHex(n: number): string {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
}

/** Collapses whitespace, lowercases, and unifies color notations (`rgb()` → `#rrggbb`, `#rgb` → `#rrggbb`). */
export function normalizeCssValue(value: string): string {
  let out = value
    .replace(/[\t\n\f\r ]+/g, ' ')
    .trim()
    .toLowerCase();
  out = out.replace(RGB, (_m, r: string, g: string, b: string, a: string) => {
    if (a !== undefined && Number(a) !== 1) return `rgba(${r}, ${g}, ${b}, ${a})`;
    return `#${toHex(Number(r))}${toHex(Number(g))}${toHex(Number(b))}`;
  });
  SHORT_HEX.lastIndex = 0;
  out = out.replace(
    SHORT_HEX,
    (_m, r: string, g: string, b: string) => `#${r}${r}${g}${g}${b}${b}`,
  );
  return out;
}

// --- DOM comparison ---------------------------------------------------------------------------

const VERBATIM_TEXT_PARENTS = new Set(['pre', 'textarea', 'script', 'style']);

const collapseText = (value: string): string => value.replace(/[\t\n\f\r ]+/g, ' ');

function normalizeChildText(value: string, parentTag: string): string {
  if (VERBATIM_TEXT_PARENTS.has(parentTag)) return value;
  return collapseText(value);
}

/**
 * Strict tier: the fast path. Instead of a boolean, the aligned walk collects *gaps* — source
 * elements, attributes and declarations without an equal counterpart, plus a text flag — and the
 * first divergence (for reports). Aligned-and-equal items are verbatim present in the output, so
 * only gaps reach ablation: that keeps whole-document loads fast (the editor's own `getHTML()`
 * output has almost no gaps). Attributes the schema *adds* when rendering (`data-align`,
 * derived styles, defaults) are ignored — the semantic tier proves they carry no loss.
 */
export interface EquivalenceGaps {
  /** Source elements (with paths) that have no equal counterpart. */
  elements: { path: number[] }[];
  /** Source attributes (with paths) absent or changed in the counterpart. */
  attrs: { path: number[]; name: string; value: string }[];
  /** Source style declarations (with paths) absent or changed in the counterpart. */
  decls: { path: number[]; prop: string; value: string }[];
  /** Any text/kind/count divergence: the concatenated text decides. */
  textMismatch: boolean;
  /** First divergence in walk order, for reports. */
  firstReason: { reason: RawHtmlReason; detail: string } | null;
}

export function collectGaps(original: Element, rendered: Element | null): EquivalenceGaps {
  const gaps: EquivalenceGaps = {
    elements: [],
    attrs: [],
    decls: [],
    textMismatch: false,
    firstReason: null,
  };
  const fail = (reason: RawHtmlReason, detail: string) => {
    gaps.firstReason ??= { reason, detail };
  };
  const markSubtree = (el: Element, path: number[]) => {
    gaps.elements.push({ path });
    for (const attr of el.attributes) {
      if (attr.name.toLowerCase() === 'style') {
        for (const [prop, value] of parseStyleDeclarations(attr.value))
          gaps.decls.push({ path, prop, value });
      } else gaps.attrs.push({ path, name: attr.name.toLowerCase(), value: attr.value });
    }
    [...el.children].forEach((child) => {
      markSubtree(child, [...path, [...el.childNodes].indexOf(child)]);
    });
    gaps.textMismatch = true;
  };
  const walk = (a: Element, b: Element, path: number[]) => {
    const tag = a.tagName.toLowerCase();
    const bTag = b.tagName.toLowerCase();
    if (tag !== bTag) {
      fail('element', `tag ${tag} became ${bTag}`);
      markSubtree(a, path);
      return;
    }
    const bAttrs = new Map<string, string>();
    for (const attr of b.attributes) bAttrs.set(attr.name.toLowerCase(), attr.value);
    for (const attr of a.attributes) {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (!bAttrs.has(name)) {
        fail('attribute', `lost attribute ${name}`);
        if (name === 'style') {
          for (const [prop, v] of parseStyleDeclarations(value))
            gaps.decls.push({ path, prop, value: v });
        } else gaps.attrs.push({ path, name, value });
        continue;
      }
      if (name === 'style') {
        const setA = parseStyleDeclarations(value);
        const setB = parseStyleDeclarations(bAttrs.get(name) ?? '');
        if (setA.size !== setB.size)
          fail('style', `style declarations ${setA.size} became ${setB.size}`);
        for (const [property, v] of setA) {
          if (setB.get(property) !== v) {
            fail('style', `style ${property}: ${v} became ${setB.get(property) ?? '∅'}`);
            gaps.decls.push({ path, prop: property, value: v });
          }
        }
      } else if (bAttrs.get(name) !== value) {
        fail('attribute', `attribute ${name} changed`);
        gaps.attrs.push({ path, name, value });
      }
    }
    const aKids = [...a.childNodes];
    const bKids = [...b.childNodes];
    if (aKids.length !== bKids.length) {
      fail('element', `children ${aKids.length} became ${bKids.length}`);
      gaps.textMismatch = true;
    }
    const n = Math.min(aKids.length, bKids.length);
    for (let i = 0; i < n; i++) {
      const x = aKids[i]!;
      const y = bKids[i]!;
      if (x.nodeType === 1 && y.nodeType === 1) walk(x as Element, y as Element, [...path, i]);
      else if (x.nodeType === 3 && y.nodeType === 3) {
        if (
          normalizeChildText(x.textContent ?? '', tag) !==
          normalizeChildText(y.textContent ?? '', bTag)
        ) {
          fail('element', 'text changed');
          gaps.textMismatch = true;
        }
      } else {
        // Kind divergence, or comments/PIs (information the schema cannot hold).
        fail(
          'element',
          x.nodeType === 1
            ? `lost element ${(x as Element).tagName.toLowerCase()}`
            : 'text changed',
        );
        if (x.nodeType === 1) markSubtree(x as Element, [...path, i]);
        else gaps.textMismatch = true;
      }
    }
    for (let i = n; i < aKids.length; i++) {
      const x = aKids[i]!;
      if (x.nodeType === 1) {
        fail('element', `lost element ${(x as Element).tagName.toLowerCase()}`);
        markSubtree(x as Element, [...path, i]);
      } else {
        fail('element', 'text changed');
        gaps.textMismatch = true;
      }
    }
  };
  if (!rendered) {
    fail('element', 'block does not survive the schema round trip');
    markSubtree(original, []);
    return gaps;
  }
  walk(original, rendered, []);
  return gaps;
}

export const gapsClean = (gaps: EquivalenceGaps): boolean =>
  !gaps.elements.length && !gaps.attrs.length && !gaps.decls.length && !gaps.textMismatch;

// --- semantic tier: ablation + fixpoint ---------------------------------------------------------
//
// The strict tier rejects anything the schema re-represents (consumed attributes like `align`,
// derived structures like `colgroup` or wrapping paragraphs, `span`→`mark` renderings), even
// though nothing is lost. The semantic tier keeps a block when two conditions hold:
// 1. fixpoint: parse → serialize → parse is stable (`docA.eq(docB)`);
// 2. ablation: every source attribute, style declaration and element either influences the
//    parsed document (so the schema state carries it — proven by removing it and observing a
//    different document) or appears verbatim in the serialized output; all source text appears
//    in the serialized output. Anything else is silent loss, and the block becomes `rawHtml`.
// Only the strict tier's failure reaches here, so the editor's own `getHTML()` output (already
// a fixpoint) never pays for ablation.

/** Values tried to prove that the schema reads an attribute (numeric, color, keyword). */
const ATTRIBUTE_PROBES = ['2', '#123456', 'rcm-probe'];

type PMDoc = ReturnType<ReturnType<typeof ProseMirrorParser.fromSchema>['parse']>;

function parseBlockHtml(blockHtml: string, schema: Schema): PMDoc | null {
  try {
    return ProseMirrorParser.fromSchema(schema).parse(elementFromString(blockHtml));
  } catch {
    return null;
  }
}

/** Serialized `doc` inside a container element (for whole-subtree presence searches). */
function serializeDoc(doc: PMDoc, schema: Schema): Element {
  patchHtmlSerializer(schema);
  const container = elementFromString('');
  // Built in `container`'s inert (DOMParser) document: images in it are never fetched.
  DOMSerializer.fromSchema(schema).serializeFragment(
    doc.content,
    { document: container.ownerDocument },
    container,
  );
  return container;
}

const docEq = (a: PMDoc | null, b: PMDoc | null): boolean => !!a && !!b && a.eq(b);

function nodeAtPath<T extends Node>(root: Node, path: number[]): T | null {
  let node: Node | null = root;
  for (const index of path) {
    node = node?.childNodes[index] ?? null;
    if (!node) return null;
  }
  return node as T;
}

/**
 * Markup of `block` with `surgery` applied to the element at `path`. Surgery runs inside a
 * wrapper (never on a detached root, where removal would be a silent no-op), and the wrapper's
 * content is what the schema would parse.
 */
function alteredHtml(
  block: Element,
  path: number[],
  surgery: (root: Element, target: Element) => void,
): string | null {
  const wrapper = block.ownerDocument.createElement('div');
  wrapper.appendChild(block.cloneNode(true));
  const target = nodeAtPath<Element>(wrapper, [0, ...path]);
  if (!target) return null;
  surgery(wrapper, target);
  return wrapper.innerHTML;
}

function unwrapElement(_root: Element, target: Element): void {
  target.replaceWith(...[...target.childNodes]);
}

/**
 * Every string the parsed document carries in node/mark attributes, lowercased: an ignored
 * source attribute whose value is already here is redundant (e.g. `data-background-color`
 * duplicating the `style` the schema reads), not lost.
 */
export function docAttrValues(doc: PMDoc): Set<string> {
  const out = new Set<string>();
  const walk = (value: unknown, inAttrs: boolean) => {
    if (typeof value === 'string') {
      if (inAttrs) out.add(value.toLowerCase());
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, false);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) walk(item, inAttrs || key === 'attrs');
    }
  };
  try {
    walk(doc.toJSON(), false);
  } catch {
    // A document that cannot serialize is never equivalent; callers check the fixpoint first.
  }
  return out;
}

/** Elements that start a new line box: whitespace next to their edges is not rendered. */
const BLOCK_BOUNDARY_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'caption',
  'col',
  'colgroup',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);
// Private-use markers (never in rendered text that matters here).
const BOUNDARY = '\ue000';
const VERBATIM_SPACE = '\ue001';

/**
 * Concatenated descendant text as HTML renders it: verbatim segments exact, the rest
 * whitespace-collapsed, and collapsible spaces at block boundaries and around `<br>` dropped
 * (`<h2>\n  title\n</h2>` reads `title`). Split/merge-insensitive: boundaries and `<br>`
 * themselves leave no trace (element structure is checked separately).
 */
export function blockText(root: Element): string {
  let out = '';
  const walk = (node: Node, verbatim: boolean) => {
    if (node.nodeType === 3) {
      const text = node.textContent ?? '';
      out += verbatim ? text.replace(/ /g, VERBATIM_SPACE) : collapseText(text);
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = (node as Element).tagName.toLowerCase();
    const boundary = tag === 'br' || BLOCK_BOUNDARY_TAGS.has(tag);
    if (boundary) out += BOUNDARY;
    const kids = node.childNodes;
    for (let i = 0; i < kids.length; i++)
      walk(kids[i]!, verbatim || VERBATIM_TEXT_PARENTS.has(tag));
    if (boundary) out += BOUNDARY;
  };
  walk(root, VERBATIM_TEXT_PARENTS.has(root.tagName.toLowerCase()));
  return out
    .replace(/ *\ue000[ \ue000]*/g, '')
    .replace(/^ +| +$/g, '')
    .replace(/\ue001/g, ' ');
}

/**
 * Semantic equivalence (see tier docs above): only the strict tier's gaps are ablated.
 * Aligned-and-equal items are verbatim present in the output, so they need no proof.
 */
export function checkBlockSemantically(
  block: Element,
  schema: Schema,
  gaps: EquivalenceGaps,
): { reason: RawHtmlReason; detail: string } | null {
  patchHtmlSerializer(schema);
  const docA = parseBlockHtml(block.outerHTML, schema);
  if (!docA) return { reason: 'element', detail: 'block failed to parse' };
  const outRoot = serializeDoc(docA, schema);
  const docB = parseBlockHtml(outRoot.innerHTML, schema);
  if (!docEq(docA, docB)) return { reason: 'element', detail: 'schema round trip is unstable' };

  const parsedAltered = (altered: string | null): PMDoc | null =>
    altered === null ? null : parseBlockHtml(altered, schema);
  const tagAt = (path: number[]): string | null =>
    nodeAtPath<Element>(block, path)?.tagName.toLowerCase() ?? null;

  // Elements without a counterpart: an element the schema ignores must still show up verbatim
  // in the output. Shallowest first: a lost wrapper decides before its descendants ablate.
  const elements = [...gaps.elements].sort((a, b) => a.path.length - b.path.length);
  for (const { path } of elements) {
    const tag = tagAt(path);
    if (!tag) continue;
    const el = nodeAtPath<Element>(block, path);
    // Bare phrasing spans carry no information of their own (children are checked as text).
    if (tag === 'span' && (el?.attributes.length ?? 0) === 0) continue;
    const unwrapped = alteredHtml(block, path, unwrapElement);
    const removed = alteredHtml(block, path, (_root, target) => target.remove());
    if (docEq(parsedAltered(unwrapped), docA) || docEq(parsedAltered(removed), docA)) {
      if (outRoot.getElementsByTagName(tag).length === 0)
        return { reason: 'element', detail: `lost element ${tag}` };
    }
  }

  // Attributes and declarations without a counterpart: ignored ones must show up verbatim in
  // the output, unless their value already reached the document through another channel.
  const covered = new Set<string>();
  if (gaps.attrs.length || gaps.decls.length)
    for (const value of docAttrValues(docA)) covered.add(normalizeCssValue(value));
  const isCovered = (value: string) => covered.has(normalizeCssValue(value));
  // An attribute the schema reads (another value changes the document) but whose removal does
  // not is at the schema default (`colspan="1"`): the serializer omits it, nothing is lost.
  const readsAttribute = (path: number[], name: string, value: string) =>
    ATTRIBUTE_PROBES.some(
      (probe) =>
        probe !== value &&
        !docEq(
          parsedAltered(
            alteredHtml(block, path, (_root, target) => target.setAttribute(name, probe)),
          ),
          docA,
        ),
    );
  for (const { path, name, value } of gaps.attrs) {
    const tag = tagAt(path);
    if (!tag) continue;
    const altered = alteredHtml(block, path, (_root, target) => target.removeAttribute(name));
    if (
      docEq(parsedAltered(altered), docA) &&
      !isCovered(value) &&
      !readsAttribute(path, name, value)
    ) {
      const present = [...outRoot.getElementsByTagName(tag)].some(
        (candidate) => candidate.getAttribute(name) === value,
      );
      if (!present) return { reason: 'attribute', detail: `lost attribute ${name}` };
    }
  }
  for (const { path, prop, value } of gaps.decls) {
    const tag = tagAt(path);
    if (!tag) continue;
    const altered = alteredHtml(block, path, (_root, target) => {
      const next = parseStyleDeclarations(target.getAttribute('style') ?? '');
      next.delete(prop);
      if (next.size)
        target.setAttribute('style', [...next].map(([p, v]) => `${p}: ${v}`).join('; '));
      else target.removeAttribute('style');
    });
    if (docEq(parsedAltered(altered), docA) && !isCovered(value)) {
      const present = [...outRoot.getElementsByTagName(tag)].some(
        (candidate) =>
          parseStyleDeclarations(candidate.getAttribute('style') ?? '').get(prop) === value,
      );
      if (!present) return { reason: 'style', detail: `lost style ${prop}: ${value}` };
    }
  }

  // Text: everything the source carries must reach the output (split/merge-insensitive).
  if (gaps.textMismatch && blockText(block) !== blockText(outRoot))
    return { reason: 'element', detail: 'text changed' };
  return null;
}

/**
 * Whole-document round trip (perf fast path): one parse + one serialize for all top-level
 * blocks, so a lossless load pays no per-block cost. The input string is the concatenation of
 * the blocks' `outerHTML`, parsed with the same `elementFromString` body parsing the per-block
 * path uses; the caller pairs rendered children with originals by index. Returns null on any
 * failure so the caller falls back to the per-block check.
 */
function roundtripWholeDocument(blocksHtml: string, schema: Schema): Element | null {
  // Same serialization `getHTML()` uses (see `roundtripBlock`).
  patchHtmlSerializer(schema);
  try {
    const doc = ProseMirrorParser.fromSchema(schema).parse(elementFromString(blocksHtml));
    const container = elementFromString('');
    // Built in `container`'s inert (DOMParser) document: images in it are never fetched.
    DOMSerializer.fromSchema(schema).serializeFragment(
      doc.content,
      { document: container.ownerDocument },
      container,
    );
    return container;
  } catch {
    return null;
  }
}

/** Parses one block with the schema and serializes it back; null when the round trip drops it. */
function roundtripBlock(blockHtml: string, schema: Schema): Element | null {
  // Same serialization `getHTML()` uses: the fidelity patch must be in place before comparing.
  // (The guard runs before the `htmlFidelity` extension's own `onBeforeCreate` in kit order.)
  patchHtmlSerializer(schema);
  let doc;
  try {
    doc = ProseMirrorParser.fromSchema(schema).parse(elementFromString(blockHtml));
  } catch {
    return null;
  }
  const container = elementFromString('');
  // Built in `container`'s inert (DOMParser) document: images in it are never fetched.
  DOMSerializer.fromSchema(schema).serializeFragment(
    doc.content,
    { document: container.ownerDocument },
    container,
  );
  const elements = [...container.childNodes].filter((n) => n.nodeType === 1) as Element[];
  // Whitespace-only text siblings of the single element are insignificant; anything else fails.
  const significant = [...container.childNodes].filter(
    (n) => n.nodeType !== 3 || (n.textContent ?? '').replace(/[\t\n\f\r ]+/g, '') !== '',
  );
  if (elements.length !== 1 || significant.length !== 1) return null;
  return elements[0]!;
}

export function checkBlockEquivalent(
  block: Element,
  schema: Schema,
): { reason: RawHtmlReason; detail: string } | null {
  let rendered: Element | null = null;
  try {
    rendered = roundtripBlock(block.outerHTML, schema);
  } catch {
    rendered = null;
  }
  const gaps = collectGaps(block, rendered);
  if (gapsClean(gaps)) return null;
  // The strict tier rejects re-represented content too; the semantic tier keeps it when nothing
  // is lost (ablation + fixpoint over the gaps only). A kept block reports nothing.
  try {
    if (!checkBlockSemantically(block, schema, gaps)) return null;
  } catch {
    // Ablation must never fail a load: fall through to the strict verdict.
  }
  return (
    gaps.firstReason ?? {
      reason: 'element',
      detail: 'block does not survive the schema round trip',
    }
  );
}

// --- top-level split ----------------------------------------------------------------------------

function parseFullDocument(input: string): Document | null {
  try {
    if (typeof DOMParser === 'undefined') return null;
    return new DOMParser().parseFromString(input, 'text/html');
  } catch {
    return null;
  }
}

/**
 * Escaped markup of a top-level text node: `textContent` is entity-decoded, so pushing
 * it back raw would turn `&lt;b&gt;` into a live `<b>` (silent loss of literal text) and an
 * escaped placeholder into a live `rawHtml` node. The serializer round trip escapes `&`, `<`
 * and `>` (and `U+00A0` as `&nbsp;`).
 */
function escapeTextMarkup(text: string): string {
  const host = document.createElement('div');
  host.textContent = text;
  return host.innerHTML;
}

/** Applies the policy to every `rawHtml` placeholder payload in `doc`, re-encoding what was cleaned. */
function sanitizePlaceholderPayloads(
  doc: Document,
  options: PreserveOptions,
): PolicyRemovedEntry[] {
  const removed: PolicyRemovedEntry[] = [];
  for (const el of doc.querySelectorAll(`[${RAW_HTML_ATTR}]`)) {
    const payload = el.getAttribute(RAW_HTML_ATTR) ?? '';
    if (!payload) continue;
    let applied: ApplyPolicyResult;
    try {
      // A throwing function policy must not break the load: the payload stays verbatim (the
      // parse-rule sanitizer and the script-less preview still bound it).
      applied = applyHtmlPolicy(payload, options);
    } catch {
      continue;
    }
    if (applied.removed.length) {
      el.setAttribute(RAW_HTML_ATTR, applied.html);
      removed.push(...applied.removed);
    }
  }
  return removed;
}

/**
 * Policy pass over `rawHtml` placeholder payloads inside `html`: the whole-document pass
 * sees only the escaped attribute, never the live markup a placeholder carries, so payloads get
 * the policy on their own — sanitize mode cleans an inline handler before anything can render
 * it. Returns `html` byte-identical when nothing was removed; removals are reported (never
 * silent).
 */
export function sanitizeRawHtmlPlaceholders(
  html: string,
  options: PreserveOptions,
): { html: string; removed: PolicyRemovedEntry[] } {
  if (!html.includes(RAW_HTML_ATTR)) return { html, removed: [] };
  const parsed = parseFullDocument(html);
  if (!parsed) return { html, removed: [] };
  const removed = sanitizePlaceholderPayloads(parsed, options);
  if (!removed.length) return { html, removed };
  return { html: `${parsed.head.innerHTML}${parsed.body.innerHTML}`, removed };
}

/**
 * Runs the policy, then wraps every top-level block the schema cannot round-trip in a `rawHtml`
 * placeholder. Without the `rawHtml` node in the schema (feature disabled) the policy output is
 * returned as-is with an empty `rawHtml` report (previous behavior: scan only).
 */
export function preserveHtmlForLoad(
  input: string,
  schema: Schema,
  options: PreserveOptions,
): PreserveResult {
  const { html: policyHtml, removed } = applyHtmlPolicy(input, options);
  let clean = policyHtml;
  const empty: PreserveResult = {
    html: clean,
    policyHtml: clean,
    rawHtml: [],
    policyRemoved: removed,
  };
  if (!schema.nodes[RAW_HTML]) return empty;
  const parsed = parseFullDocument(clean);
  if (!parsed) return empty;
  // Placeholder payloads are policy inputs of their own; when one was cleaned the
  // policy output is the re-serialized document (something was removed anyway, so byte
  // identity is already gone) and the load's report carries the removals.
  if (clean.includes(RAW_HTML_ATTR)) {
    const placeholderRemoved = sanitizePlaceholderPayloads(parsed, options);
    if (placeholderRemoved.length) {
      removed.push(...placeholderRemoved);
      clean = `${parsed.head.innerHTML}${parsed.body.innerHTML}`;
      empty.html = clean;
      empty.policyHtml = clean;
    }
  }

  const blocks: ChildNode[] = [...parsed.head.childNodes, ...parsed.body.childNodes];
  // Fast path (perf): the editor's own `getHTML()` output — the CI-hot case — is a flat
  // sequence of elements that round-trips losslessly. One parse + one serialize proves it, and
  // index-aligned `collectGaps` (the same strict comparison the per-block path uses) confirms
  // every block. Anything else (text/comments, dropped/split blocks, any gap) falls back to the
  // per-block check below — including the semantic tier — so verdicts never change.
  if (blocks.every((node) => node.nodeType === 1)) {
    const joined = blocks.map((node) => (node as Element).outerHTML).join('');
    const rendered = roundtripWholeDocument(joined, schema);
    const renderedChildren = rendered ? [...rendered.childNodes] : [];
    if (
      renderedChildren.length === blocks.length &&
      renderedChildren.every((node) => node.nodeType === 1) &&
      blocks.every((node, index) =>
        gapsClean(collectGaps(node as Element, renderedChildren[index] as Element)),
      )
    ) {
      return { html: joined, policyHtml: clean, rawHtml: [], policyRemoved: removed };
    }
  }
  const rawHtml: RawHtmlEntry[] = [];
  const out: string[] = [];
  blocks.forEach((node, index) => {
    if (node.nodeType === 3) {
      // Text (including inter-block whitespace): the schema wraps it in a paragraph. Escaped,
      // so literal text stays literal instead of becoming live markup.
      out.push(escapeTextMarkup(node.textContent ?? ''));
      return;
    }
    if (node.nodeType !== 1) {
      // Comments (processing instructions cannot occur from text/html parsing).
      const markup =
        node.nodeType === 8 ? `<!--${node.textContent ?? ''}-->` : (node.textContent ?? '');
      rawHtml.push({
        path: `[${index}]`,
        reason: 'element',
        detail: 'comment',
        html: snippet(markup),
      });
      out.push(rawHtmlPlaceholder(markup));
      return;
    }
    const el = node as Element;
    const failed = checkBlockEquivalent(el, schema);
    if (!failed) {
      out.push(el.outerHTML);
      return;
    }
    const source = el.outerHTML;
    rawHtml.push({
      path: `[${index}](${el.tagName.toLowerCase()})`,
      reason: failed.reason,
      detail: failed.detail,
      html: snippet(source),
    });
    out.push(rawHtmlPlaceholder(source));
  });
  return { html: out.join(''), policyHtml: clean, rawHtml, policyRemoved: removed };
}
