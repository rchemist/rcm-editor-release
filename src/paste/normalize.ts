// Paste normalizer (Word/HWP detection, Office junk removal, Word list reconstruction); the allowlist is the editor schema.
// adds per-source mapping on top: Word/HWP clipboard class rules inlined, `mso-*`
// declarations mapped to the schema property they carry, Google Docs' wrapper stripped.
import type { Schema } from '@tiptap/pm/model';
import { parseImageAlign } from '../extensions/image';
import { parsePxInt } from '../extensions/cssLength';
import { RAW_HTML_ATTR, rawHtmlPlaceholder } from '../extensions/rawHtml';
import { DEFAULT_IFRAME_HOSTS, isAllowedIframeSrc } from '../html/policy';
import type { HtmlPolicy } from '../html/policy';

export type HwpClipboardFormat = 'hwp' | 'hwpx';

export interface PasteDropped {
  tag: string;
  reason: string;
  html: string;
}

export interface NormalizePastedHtmlOptions {
  schema: Schema;
  /** The editor's HTML policy (default `'sanitize'`): decides which embeds are kept. */
  policy?: HtmlPolicy;
  /** Allowed embed hosts under `'sanitize'` (default: the policy's default list). */
  iframeHosts?: readonly string[];
}

export interface NormalizePastedHtmlResult {
  html: string;
  dropped: PasteDropped[];
}

const WORD_HTML_SIGNATURES = [
  /<!--\s*\[if\s+[^\]]*\bmso\b/i,
  /\bclass\s*=\s*["'][^"']*\b(?:Mso[A-Z]|WordSection\d)/i,
  /\bstyle\s*=\s*["'][^"']*\bmso-[\w-]+\s*:/i,
  /<\s*(?:o:p|v:[\w-]+|w:[\w-]+)/i,
  /xmlns(?::[ovw])?\s*=\s*["']urn:schemas-microsoft-com:/i,
  /<meta\b[^>]*(?:Microsoft(?:®)? Word|Word\.Document)/i,
  /urn:schemas-microsoft-com:office:word/i,
] as const;

// Synthetic, conservative provenance markers only. These markers classify a clipboard
// payload for normalization; they never make its HTML trusted (the policy still runs after).
const HWP_NAMESPACE_MARKERS: ReadonlyArray<readonly [RegExp, HwpClipboardFormat]> = [
  [
    /xmlns(?::[\w-]+)?\s*=\s*["']https?:\/\/(?:www\.)?hancom\.co\.kr\/hwpml\/(?:2011|[2-9]\d{3})\/paragraph["']/i,
    'hwpx',
  ],
  [
    /xmlns(?::[\w-]+)?\s*=\s*["']https?:\/\/(?:www\.)?hancom\.co\.kr\/(?:hwpml(?!\/(?:2011|[2-9]\d{3})\/paragraph)|hwp(?=[/"']))[^"']*["']/i,
    'hwp',
  ],
];

export function isWordClipboardHtml(html: string): boolean {
  return WORD_HTML_SIGNATURES.some((signature) => signature.test(html));
}

export function isHwpClipboardHtml(html: string): boolean {
  return classifyHwpClipboardProvenance(html) !== null;
}

/**
 * Classify synthetic HWP/HWPX provenance from a meta/generator or markup marker allowlist
 * (MIME-based clipboard types stay out of this normalizer: it only sees HTML). Conflicting
 * markers fail closed to null.
 */
export function classifyHwpClipboardProvenance(html: string): HwpClipboardFormat | null {
  return reconcileHwpFormats(hwpClipboardHtmlFormats(html));
}

function hwpClipboardHtmlFormats(html: string): HwpClipboardFormat[] {
  const formats: Array<HwpClipboardFormat | null> = [];
  for (const [signature, format] of HWP_NAMESPACE_MARKERS) {
    if (signature.test(html)) formats.push(format);
  }

  if (typeof DOMParser !== 'undefined') {
    try {
      formats.push(
        ...hwpClipboardDocumentFormats(new DOMParser().parseFromString(html, 'text/html')),
      );
    } catch {
      // string markers only
    }
  }

  return hwpFormatList(formats);
}

/** Meta/generator and data-attribute Hancom markers of an already-parsed clipboard document. */
function hwpClipboardDocumentFormats(document: Document): Array<HwpClipboardFormat | null> {
  const formats: Array<HwpClipboardFormat | null> = [];
  for (const meta of Array.from(document.querySelectorAll('meta'))) {
    const name = (meta.getAttribute('name') ?? '').trim().toLowerCase();
    const content = (meta.getAttribute('content') ?? '').trim();
    if (name === 'generator' || name === 'application-name') {
      formats.push(classifyHancomGenerator(content));
    }
    if (name === 'hancom-format' || name === 'hwp-format') {
      formats.push(exactHwpFormat(content));
    }
  }

  for (const element of Array.from(
    document.querySelectorAll('[data-hancom-format], [data-hwp-format]'),
  )) {
    formats.push(
      exactHwpFormat(
        element.getAttribute('data-hancom-format') ?? element.getAttribute('data-hwp-format') ?? '',
      ),
    );
  }

  return formats;
}

function hwpFormatList(formats: ReadonlyArray<HwpClipboardFormat | null>): HwpClipboardFormat[] {
  return formats.filter((format): format is HwpClipboardFormat => !!format);
}

function classifyHancomGenerator(generator: string): HwpClipboardFormat | null {
  if (!/^hancom(?:\s+office)?\s+(?:hanword|hwp|hwpx)\b/i.test(generator)) return null;
  return /\bhwpx\b/i.test(generator) ? 'hwpx' : 'hwp';
}

function exactHwpFormat(value: string): HwpClipboardFormat | null {
  const normalized = value.trim().toLowerCase();
  return normalized === 'hwp' || normalized === 'hwpx' ? normalized : null;
}

function reconcileHwpFormats(
  candidates: ReadonlyArray<HwpClipboardFormat | null | undefined>,
): HwpClipboardFormat | null {
  const formats = new Set(
    candidates.filter((candidate): candidate is HwpClipboardFormat => !!candidate),
  );
  return formats.size === 1 ? (formats.values().next().value ?? null) : null;
}

const SNIPPET = 200;
const snippet = (value: string): string =>
  value.length > SNIPPET ? `${value.slice(0, SNIPPET)}…` : value;

/**
 * Office/Hancom clipboard noise: document chrome and application markup that carries no
 * visible content. Removed silently (never reported in `dropped`).
 */
const NOISE_ELEMENTS = new Set(['base', 'link', 'meta', 'title', 'xml']);

const NOISE_HANCOM_ELEMENTS = new Set([
  'hp:bindata',
  'hp:binarydata',
  'hp:script',
  'hwp:bindata',
  'hwp:binarydata',
  'hwp:script',
]);

/** Elements removed with their content and reported in `dropped` (code, not content). */
const DROPPED_WITH_CONTENT = new Set(['script', 'style', 'textarea', 'template']);

/** Policy-allowed embeds are kept as `rawHtml` placeholders instead of being dropped. */
const EMBED_ELEMENTS = new Set(['iframe', 'object', 'embed']);

function normalizedElementName(element: Element): string {
  return element.tagName.toLowerCase();
}

function removeComments(document: Document): void {
  const walker = document.createTreeWalker(document, 128);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach((comment) => comment.parentNode?.removeChild(comment));
}

function removeOfficeNoise(document: Document): void {
  for (const element of Array.from(document.querySelectorAll('*'))) {
    const name = normalizedElementName(element);
    const prefix = name.includes(':') ? name.split(':', 1)[0] : '';
    if (
      NOISE_ELEMENTS.has(name) ||
      NOISE_HANCOM_ELEMENTS.has(name) ||
      name === 'o:p' ||
      prefix === 'v' ||
      element.namespaceURI === 'urn:schemas-microsoft-com:vml'
    ) {
      element.remove();
    }
  }
}

// --- Word list reconstruction (ported, algorithm unchanged) ----------------------------------

interface WordListItem {
  level: number;
  type: 'ol' | 'ul';
  number: number | null;
  content: DocumentFragment;
}

interface OpenList {
  element: HTMLOListElement | HTMLUListElement;
  type: 'ol' | 'ul';
  lastItem: HTMLLIElement | null;
  nextNumber: number | null;
}

function normalizeWordLists(parent: Element): void {
  let node: ChildNode | null = parent.firstChild;
  while (node) {
    if (node instanceof HTMLParagraphElement && parseWordListItem(node)) {
      const run = collectWordListRun(node);
      if (isStructurallyUnambiguous(run.items)) {
        const lists = buildSemanticLists(parent.ownerDocument, run.items);
        parent.insertBefore(lists, node);
        const next = run.nodes.at(-1)?.nextSibling ?? null;
        run.nodes.forEach((runNode) => runNode.remove());
        node = next;
        continue;
      }
    }

    const next = node.nextSibling;
    if (node instanceof Element) normalizeWordLists(node);
    node = next;
  }
}

function collectWordListRun(start: HTMLParagraphElement): {
  items: WordListItem[];
  nodes: ChildNode[];
} {
  const items: WordListItem[] = [];
  const nodes: ChildNode[] = [];
  let current: ChildNode | null = start;

  while (current instanceof HTMLParagraphElement) {
    const item = parseWordListItem(current);
    if (!item) break;
    items.push(item);
    nodes.push(current);

    let next: ChildNode | null = current.nextSibling;
    const whitespace: ChildNode[] = [];
    while (next?.nodeType === 3 && !next.textContent?.trim()) {
      whitespace.push(next);
      next = next.nextSibling;
    }
    if (!(next instanceof HTMLParagraphElement) || !parseWordListItem(next)) break;
    nodes.push(...whitespace);
    current = next;
  }

  return { items, nodes };
}

function parseWordListItem(paragraph: HTMLParagraphElement): WordListItem | null {
  if (!/\bMsoListParagraph(?:CxSp(?:First|Middle|Last))?\b/i.test(paragraph.className)) {
    return null;
  }

  const listMatch = paragraph
    .getAttribute('style')
    ?.match(/\bmso-list\s*:\s*l\d+\s+level(\d+)\s+lfo\d+\b/i);
  if (!listMatch) return null;

  const level = Number.parseInt(listMatch[1] ?? '', 10);
  if (!Number.isSafeInteger(level) || level < 1 || level > 9) return null;

  const marker = Array.from(paragraph.querySelectorAll('span')).find((span) =>
    /(?:^|;)\s*mso-list\s*:\s*ignore(?:\s*;|\s*$)/i.test(span.getAttribute('style') ?? ''),
  );
  if (!marker) return null;

  const markerText = (marker.textContent ?? '').replace(/\u00a0/g, ' ').trim();
  const ordered = markerText.match(/^(?:\((\d{1,4})\)|(\d{1,4})[.)])$/);
  const bullet = /^[•·▪◦○●■□–—-]$/.test(markerText);
  if (!ordered && !bullet) return null;

  const clone = paragraph.cloneNode(true) as HTMLParagraphElement;
  const cloneMarker = Array.from(clone.querySelectorAll('span')).find((span) =>
    /(?:^|;)\s*mso-list\s*:\s*ignore(?:\s*;|\s*$)/i.test(span.getAttribute('style') ?? ''),
  );
  cloneMarker?.remove();
  trimBoundaryWhitespace(clone);

  const content = paragraph.ownerDocument.createDocumentFragment();
  while (clone.firstChild) content.append(clone.firstChild);
  const numberText = ordered?.[1] ?? ordered?.[2];
  return {
    level,
    type: ordered ? 'ol' : 'ul',
    number: numberText ? Number.parseInt(numberText, 10) : null,
    content,
  };
}

function trimBoundaryWhitespace(element: Element): void {
  const first = element.firstChild;
  if (first?.nodeType === 3) first.textContent = first.textContent?.replace(/^\s+/, '') ?? '';
  const last = element.lastChild;
  if (last?.nodeType === 3) last.textContent = last.textContent?.replace(/\s+$/, '') ?? '';
}

function isStructurallyUnambiguous(items: WordListItem[]): boolean {
  if (items.length === 0 || items[0]?.level !== 1) return false;
  return items.every((item, index) => index === 0 || item.level <= items[index - 1]!.level + 1);
}

function buildSemanticLists(document: Document, items: WordListItem[]): DocumentFragment {
  const root = document.createDocumentFragment();
  const stack: OpenList[] = [];

  for (const item of items) {
    while (stack.length > item.level) stack.pop();
    if (stack.length === item.level && stack[item.level - 1]?.type !== item.type) stack.pop();

    if (stack.length < item.level) {
      const list = document.createElement(item.type);
      const parent = item.level === 1 ? root : stack[item.level - 2]!.lastItem;
      parent!.append(list);
      const nextNumber = item.type === 'ol' ? (item.number ?? 1) : null;
      if (item.type === 'ol' && nextNumber !== 1) list.setAttribute('start', String(nextNumber));
      stack.push({
        element: list,
        type: item.type,
        lastItem: null,
        nextNumber,
      });
    }

    const current = stack[item.level - 1]!;
    const listItem = document.createElement('li');
    listItem.append(item.content);
    if (item.type === 'ol' && item.number !== null) {
      if (current.nextNumber !== null && item.number !== current.nextNumber) {
        listItem.setAttribute('value', String(item.number));
      }
      current.nextNumber = item.number + 1;
    }
    current.element.append(listItem);
    current.lastItem = listItem;
  }

  return root;
}

// --- per-source mapping -----------------------------------------------------------------

interface ClipboardSource {
  word: boolean;
  hwp: HwpClipboardFormat | null;
  gdocs: boolean;
}

const GDOCS_WRAPPER_MARKER = /docs-internal-guid-[0-9a-f-]+/i;

function classifyClipboardSource(html: string, document: Document): ClipboardSource {
  return {
    word: isWordClipboardHtml(html),
    hwp: reconcileHwpFormats([
      ...HWP_NAMESPACE_MARKERS.flatMap(([signature, format]) =>
        signature.test(html) ? [format] : [],
      ),
      ...hwpClipboardDocumentFormats(document),
    ]),
    gdocs: GDOCS_WRAPPER_MARKER.test(html),
  };
}

/**
 * Class rules of the clipboard's own `<style>` block (Word `p.MsoNormal{…}`, custom `.xl65`,
 * Hancom `HStyle*`), applied onto matching elements as inline declarations before the block is
 * dropped. Only selectors of the shape these sources emit — optional tag plus a single class,
 * no combinators, pseudo-classes or `@` rules — are honoured, so nothing structural can be
 * smuggled through a sheet: everything lands as declarations, which the schema allowlist then
 * filters declaration by declaration.
 */
interface ClipboardClassRule {
  tag: string | null;
  declarations: ReadonlyMap<string, string>;
}

const CLASS_RULE_SELECTOR = /^([a-z][a-z0-9]*)?\.(-?[A-Za-z_][-\w]*)$/;

function collectClipboardClassRules(document: Document): Map<string, ClipboardClassRule[]> {
  const rules = new Map<string, ClipboardClassRule[]>();
  const absorb = (css: string): void => {
    // CDO/CDC tokens (`<!--`) wrap legacy sheets; comments may sit inside rule bodies.
    const source = css.replace(/<!--|-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const block of source.match(/[^{}]+\{[^{}]*\}/g) ?? []) {
      const open = block.indexOf('{');
      const close = block.lastIndexOf('}');
      if (open < 0 || close <= open) continue;
      const declarations = new Map(
        parseStyleDeclarations(block.slice(open + 1, close)).filter(
          ([, value]) => value.trim() !== '',
        ),
      );
      if (!declarations.size) continue;
      for (const selector of block.slice(0, open).split(',')) {
        const match = CLASS_RULE_SELECTOR.exec(selector.trim());
        if (!match) continue;
        const list = rules.get(match[2]!.toLowerCase()) ?? [];
        list.push({ tag: match[1]?.toLowerCase() ?? null, declarations });
        rules.set(match[2]!.toLowerCase(), list);
      }
    }
  };

  for (const style of Array.from(document.querySelectorAll('style'))) {
    absorb(style.textContent ?? '');
  }
  // Word wraps some sheets in conditional comments; the comment text carries the markup.
  const walker = document.createTreeWalker(document, 128);
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent ?? '';
    if (/<style/i.test(text)) absorb(text.replace(/<\/?style[^>]*>/gi, ' '));
  }
  return rules;
}

function inlineClipboardClassRules(
  document: Document,
  rules: Map<string, ClipboardClassRule[]>,
): void {
  if (!rules.size) return;
  for (const element of Array.from(document.body.querySelectorAll('[class]'))) {
    const matched = Array.from(element.classList, (name) => name.toLowerCase()).flatMap(
      (cls) => rules.get(cls) ?? [],
    );
    if (!matched.length) continue;
    // Later sheet rules override earlier ones; the element's own inline style wins over both.
    const merged = new Map<string, string>();
    for (const rule of matched) {
      if (rule.tag && rule.tag !== normalizedElementName(element)) continue;
      for (const [property, value] of rule.declarations) merged.set(property, value);
    }
    for (const [property, value] of parseStyleDeclarations(element.getAttribute('style') ?? '')) {
      merged.set(property, value);
    }
    if (merged.size) {
      element.setAttribute(
        'style',
        Array.from(merged, ([property, value]) => `${property}: ${value}`).join('; '),
      );
    }
  }
}

/** `mso-*` declarations that carry a value the schema consumes, mapped to their canonical property. */
const MSO_CANONICAL_PROPS: ReadonlyArray<readonly [string, string]> = [
  ['mso-para-margin-top', 'margin-top'],
  ['mso-para-margin-right', 'margin-right'],
  ['mso-para-margin-bottom', 'margin-bottom'],
  ['mso-para-margin-left', 'margin-left'],
  ['mso-ansi-font-size', 'font-size'],
  ['mso-bidi-font-size', 'font-size'],
  ['mso-ascii-font-family', 'font-family'],
  ['mso-hansi-font-family', 'font-family'],
];

/** Hex/`rgb()`/`hsl()` colour inside an Office declaration value (`solid #c00000`). */
const COLOR_TOKEN_RE = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/i;

function colorTokenOf(value: string): string | null {
  return COLOR_TOKEN_RE.exec(value)?.[0] ?? null;
}

/** `mso-highlight` carries IE colour *names* (`yellow`); these words are not colours. */
const NON_COLOR_WORDS = new Set([
  'none',
  'transparent',
  'inherit',
  'initial',
  'unset',
  'revert',
  'solid',
  'auto',
  'windowtext',
  'window',
]);

/** First family of a `font-family` value (quotes stripped): the face the declaration names. */
function firstFontFamily(value: string | undefined): string | null {
  const first =
    value
      ?.split(',')[0]
      ?.trim()
      .replace(/^["']|["']$/g, '') ?? '';
  return first || null;
}

/** The Korean face first, deduplicated (Word repeats one face in `mso-fareast-*` and `font-family`). */
function fontStackKoreanFirst(face: string, stack: readonly string[]): string {
  const deduped = stack.filter((family) => family.toLowerCase() !== face.toLowerCase());
  return [face, ...deduped]
    .map((family) => (/[^\w-]/.test(family) ? `"${family}"` : family))
    .join(', ');
}

/**
 * Map Office `mso-*` declarations onto the schema property they carry: a canonical declaration
 * already inline wins; `mso-fareast-font-family` joins the font stack with the Korean face
 * first; `mso-shading`/`mso-highlight` carry background colours (shading only in the colour
 * forms this normalizer can verify — `windowtext` and friends are left alone). Runs after Word
 * list reconstruction, which reads `mso-list` from the raw inline style.
 */
function mapOfficeInlineStyles(root: Element): void {
  for (const element of Array.from(root.querySelectorAll('[style]'))) {
    if (!element.isConnected) continue;
    const style = element.getAttribute('style') ?? '';
    if (!/mso-/i.test(style)) continue;
    const declarations = new Map(parseStyleDeclarations(style));
    const write = (property: string, value: string): void => {
      if (!declarations.has(property) && value.trim()) declarations.set(property, value.trim());
    };

    for (const [msoProperty, canonical] of MSO_CANONICAL_PROPS) {
      const value = declarations.get(msoProperty);
      if (value) write(canonical, value);
    }

    const fareast = firstFontFamily(declarations.get('mso-fareast-font-family'));
    if (fareast) {
      const stack = (declarations.get('font-family') ?? '')
        .split(',')
        .map((family) => family.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
      write('font-family', stack.length ? fontStackKoreanFirst(fareast, stack) : fareast);
    }

    const name = normalizedElementName(element);
    if (name === 'td' || name === 'th') {
      const shading = declarations.get('mso-shading');
      const color = shading ? colorTokenOf(shading) : null;
      if (color) write('background', color);
    } else {
      const highlight = declarations.get('mso-highlight')?.trim();
      if (highlight) {
        const word = highlight.toLowerCase();
        const color =
          colorTokenOf(highlight) ??
          (/^[a-z]{3,24}$/i.test(word) && !NON_COLOR_WORDS.has(word) ? highlight : null);
        if (color) write('background-color', color);
      }
    }

    element.setAttribute(
      'style',
      Array.from(declarations, ([property, value]) => `${property}: ${value}`).join('; '),
    );
  }
}

/**
 * Google Docs wraps its payload in `<b style="font-weight:normal" id="docs-internal-guid-…">`.
 * The wrapper is a copy artefact, not content — unwrapped (children kept, nothing dropped).
 * Weightless bold wrappers are unwrapped wherever they come from: the schema cannot represent
 * "bold element, normal text" and the text must not gain bold.
 */
function unwrapWeightlessBold(root: Element): void {
  for (const element of Array.from(root.querySelectorAll('b'))) {
    if (!element.isConnected) continue;
    const weight = parseStyleDeclarations(element.getAttribute('style') ?? '')
      .find(([property]) => property === 'font-weight')?.[1]
      ?.trim()
      .toLowerCase();
    if (weight === 'normal' || weight === '400') {
      element.replaceWith(...Array.from(element.childNodes));
    }
  }
}

const BOLD_WEIGHT_RE = /^(bold(er)?|[5-9]\d{2,})$/i;

/**
 * `font-weight`/`font-style` on inline carriers cannot survive the style allowlist (they are
 * not textStyle properties), so they are materialised as the mark elements the schema parses:
 * Google Docs' `<span style="font-weight:700">x</span>` becomes `<span><b>x</b></span>`.
 * Color, pt font-size, font-family and underline already arrive through kept declarations.
 */
function foldInlineWeightStyles(root: Element): void {
  for (const element of Array.from(root.querySelectorAll('span'))) {
    if (!element.isConnected) continue;
    const declarations = parseStyleDeclarations(element.getAttribute('style') ?? '');
    const weight = declarations
      .find(([property]) => property === 'font-weight')?.[1]
      ?.trim()
      .toLowerCase();
    const fontStyle = declarations
      .find(([property]) => property === 'font-style')?.[1]
      ?.trim()
      .toLowerCase();
    const bold = weight ? BOLD_WEIGHT_RE.test(weight) : false;
    const italic = fontStyle === 'italic' || fontStyle === 'oblique';
    if (!bold && !italic) continue;

    const document = element.ownerDocument;
    if (!document) continue;
    const children = Array.from(element.childNodes);
    let carrier: Element | null = null;
    if (bold) {
      const b = document.createElement('b');
      element.append(b);
      carrier = b;
    }
    if (italic) {
      const i = document.createElement('i');
      (carrier ?? element).append(i);
      carrier = i;
    }
    carrier!.append(...children);
  }
}

/**
 * Fold the cell styles the schema's parse rules do not read directly: a cell's inline `width`
 * (pt or px, or the legacy attribute) becomes the `colwidth` attribute the cell node parses,
 * so column widths survive without a `<colgroup>`; Hancom's `vertical-align: center` (and the
 * legacy `valign=center` attribute) becomes the CSS keyword `middle` the attribute accepts. A
 * single-colour `background` shorthand on cells needs no fold — the cell attribute parses it
 * itself (see `readBackgroundColor`).
 */
function foldTableCellStyles(root: Element): void {
  for (const element of Array.from(root.querySelectorAll('td, th'))) {
    if (!element.isConnected) continue;
    if (!element.hasAttribute('colwidth')) {
      const width =
        parseStyleDeclarations(element.getAttribute('style') ?? '').find(
          ([property]) => property === 'width',
        )?.[1] ?? element.getAttribute('width');
      const px = width ? parsePxInt(width) : null;
      if (px !== null && px > 0) element.setAttribute('colwidth', String(px));
    }
    const style = element.getAttribute('style');
    if (style)
      element.setAttribute('style', style.replace(/(vertical-align\s*:\s*)center\b/i, '$1middle'));
    const valign = element.getAttribute('valign');
    if (valign && valign.trim().toLowerCase() === 'center') {
      element.setAttribute('valign', 'middle');
    }
  }
}

// --- schema allowlist (derived from src/extensions/* parse rules) ----------------------------

/**
 * Style declarations the schema's parse rules consume, per element group. Dropping the rest
 * is the purpose of paste normalization (the schema would ignore them on parse anyway).
 */
const BLOCK_STYLE_PROPS = new Set([
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'text-indent',
  'line-height',
  'text-align',
]);

const INLINE_STYLE_PROPS = new Set([
  'color',
  'background-color',
  'font-family',
  'font-size',
  'letter-spacing',
  'font-stretch',
  // Consumed by the underline/strike (`text-decoration`) and sub/sup (`vertical-align`)
  // style parse rules; kept verbatim, never synthesized.
  'text-decoration',
  'vertical-align',
]);

const TABLE_STYLE_PROPS = new Set(['width', 'border', 'margin-left', 'margin-right']);

const IMG_STYLE_PROPS = new Set([
  'width',
  'height',
  'float',
  'display',
  'margin-left',
  'margin-right',
]);

/** `data-*` attributes a schema parse-rule selector or option reads. */
const KEPT_DATA_ATTRS = new Set([
  'data-type',
  'data-id',
  'data-label',
  'data-align',
  'data-background-color',
  'data-color',
  'data-checked',
  // ProseMirror's own clipboard context marker: kept so internal copies round-trip with their
  // original slice openness instead of degrading to external-HTML behaviour (stripped it).
  'data-pm-slice',
]);

const BLOCK_WRAPPERS = new Set([
  'div',
  'section',
  'article',
  'header',
  'footer',
  'aside',
  'main',
  'nav',
  'center',
]);

interface ElementPlan {
  /** False: unwrap (children kept). Null: decided elsewhere (placeholder/embed/dropped). */
  keep: boolean;
  styles: Set<string> | null;
  /** Attribute names kept verbatim (after value checks); `data-*` from KEPT_DATA_ATTRS added. */
  attrs: Set<string> | null;
  /** Keep border `border*` declarations (table cells). */
  borders: boolean;
}

function planFor(name: string, element: Element): ElementPlan | null {
  switch (name) {
    case 'p':
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return { keep: true, styles: BLOCK_STYLE_PROPS, attrs: new Set(), borders: false };
    case 'span':
    case 'font':
      return { keep: true, styles: INLINE_STYLE_PROPS, attrs: new Set(), borders: false };
    case 'mark':
      return {
        keep: true,
        styles: new Set(['background-color']),
        attrs: new Set(),
        borders: false,
      };
    case 'a':
      return {
        keep: true,
        styles: null,
        attrs: new Set(['href', 'target', 'rel', 'title']),
        borders: false,
      };
    case 'img':
      return {
        keep: true,
        styles: IMG_STYLE_PROPS,
        attrs: new Set(['src', 'alt', 'width', 'height', 'align']),
        borders: false,
      };
    case 'td':
    case 'th':
      // `background` (single-colour shorthand, Word shading) is parsed by the cell attribute
      // itself; `text-align` and the `align`/`colwidth` attributes feed the cell's align and
      // column-width attributes.
      return {
        keep: true,
        styles: new Set(['background-color', 'background', 'vertical-align', 'text-align']),
        attrs: new Set(['colspan', 'rowspan', 'bgcolor', 'valign', 'scope', 'align', 'colwidth']),
        borders: true,
      };
    case 'table':
      return {
        keep: true,
        styles: TABLE_STYLE_PROPS,
        attrs: new Set(['width', 'align']),
        borders: false,
      };
    case 'col':
      return {
        keep: true,
        styles: new Set(['width']),
        attrs: new Set(['width']),
        borders: false,
      };
    case 'ol':
      return { keep: true, styles: null, attrs: new Set(['start', 'type']), borders: false };
    case 'li':
      return { keep: true, styles: null, attrs: new Set(['value', 'checked']), borders: false };
    case 'b':
    case 'strong':
    case 'i':
    case 'em':
    case 'u':
    case 's':
    case 'del':
    case 'strike':
    case 'code':
    case 'sub':
    case 'sup':
    case 'blockquote':
    case 'pre':
    case 'hr':
    case 'br':
    case 'ul':
    case 'tbody':
    case 'thead':
    case 'tfoot':
    case 'tr':
    case 'colgroup':
    case 'figure':
    case 'figcaption':
      return { keep: true, styles: null, attrs: new Set(), borders: false };
    case 'div':
    case 'section':
      // Schema nodes (`textBox`, `pageBreak`, footnotes, `placeholder`) select on `data-type`;
      // other divs/sections are wrappers.
      if (element.hasAttribute('data-type') || element.hasAttribute(RAW_HTML_ATTR))
        return {
          keep: true,
          styles: new Set(['width', 'background-color']),
          attrs: new Set(),
          borders: true,
        };
      return { keep: false, styles: null, attrs: null, borders: false };
    default:
      if (BLOCK_WRAPPERS.has(name))
        return { keep: false, styles: null, attrs: null, borders: false };
      if (name === 'caption') return { keep: false, styles: null, attrs: null, borders: false };
      return null;
  }
}

/** `font` carries author styling in attributes; fold the schema-consumed ones into style. */
function foldFontElement(element: Element): void {
  const decls: string[] = [];
  const color = element.getAttribute('color');
  if (color?.trim()) decls.push(`color: ${color.trim()}`);
  const face = element.getAttribute('face');
  if (face?.trim()) decls.push(`font-family: ${face.trim()}`);
  const previous = element.getAttribute('style');
  if (previous?.trim()) decls.unshift(previous.trim().replace(/;?$/, ';'));
  if (decls.length) element.setAttribute('style', decls.join(' '));
  else element.removeAttribute('style');
}

/**
 * Removes C0 controls, spaces and DEL anywhere in a URL (browsers drop tab/newline before
 * URL parsing, so a spaced `java script:` still runs). A loop: the range starts at U+0000,
 * which the `no-control-regex` rule bans in regex literals.
 */
function stripUnsafeUrlChars(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) continue;
    out += char;
  }
  return out;
}

function safeHref(rawHref: string | null): string | null {
  const href = rawHref?.trim();
  if (!href) return null;
  const compact = stripUnsafeUrlChars(href);
  const scheme = compact.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (scheme && !['http', 'https', 'mailto', 'tel'].includes(scheme)) return null;
  return href;
}

function safeImgSrc(rawSrc: string | null): string | null {
  const src = rawSrc?.trim();
  if (!src) return null;
  const compact = stripUnsafeUrlChars(src);
  const scheme = compact.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (!scheme) return src;
  if (scheme === 'javascript' || scheme === 'vbscript') return null;
  if (scheme === 'data' && /^data:text\/html/i.test(compact)) return null;
  return src;
}

function boundedInt(raw: string | null, min: number, max: number): string | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  return value >= min && value <= max ? String(value) : null;
}

function parseStyleDeclarations(style: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const declaration of style.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator < 0) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    if (!property) continue;
    out.push([property, declaration.slice(separator + 1).trim()]);
  }
  return out;
}

function isBorderProp(property: string): boolean {
  if (property === 'border') return true;
  return (
    property.startsWith('border-top') ||
    property.startsWith('border-right') ||
    property.startsWith('border-bottom') ||
    property.startsWith('border-left')
  );
}

function sanitizeElements(root: Element, dropped: PasteDropped[]): void {
  for (const original of Array.from(root.querySelectorAll('*'))) {
    if (!original.isConnected) continue;
    const name = normalizedElementName(original);
    if (EMBED_ELEMENTS.has(name)) continue;
    if (original.tagName.toLowerCase() === 'div' && original.hasAttribute(RAW_HTML_ATTR)) {
      continue;
    }
    if (DROPPED_WITH_CONTENT.has(name)) {
      dropped.push({ tag: name, reason: 'ignored', html: snippet(original.outerHTML) });
      original.remove();
      continue;
    }
    if (name === 'font') foldFontElement(original);
  }

  // Style carriers run on the original inline styles, before the allowlist filtering below
  // strips the declarations the schema does not consume.
  applyCanonicalStyleCarriers(root);

  for (const original of Array.from(root.querySelectorAll('*'))) {
    if (!original.isConnected) continue;
    const name = normalizedElementName(original);
    if (EMBED_ELEMENTS.has(name)) continue;
    if (original.tagName.toLowerCase() === 'div' && original.hasAttribute(RAW_HTML_ATTR)) {
      continue;
    }
    const plan = planFor(name === 'font' ? 'span' : name, original);
    if (!plan) {
      // Unknown wrapper: unwrap (children kept, never silently dropped).
      original.replaceWith(...Array.from(original.childNodes));
      continue;
    }
    if (!plan.keep) {
      original.replaceWith(...Array.from(original.childNodes));
      continue;
    }

    const keptAttrNames = new Set(plan.attrs ?? []);
    for (const attr of Array.from(original.attributes)) {
      // `style` is filtered declaration-by-declaration below, not dropped here.
      if (attr.name.toLowerCase() === 'style') continue;
      // Event handlers stay for the policy plugin: it removes and reports them
      // (`policyRemoved`), which existing guard tests assert on the paste path.
      if (/^on/i.test(attr.name)) continue;
      if (attr.name.toLowerCase().startsWith('data-')) {
        if (!KEPT_DATA_ATTRS.has(attr.name.toLowerCase())) original.removeAttribute(attr.name);
        continue;
      }
      if (!keptAttrNames.has(attr.name.toLowerCase())) original.removeAttribute(attr.name);
    }

    if (name === 'a') {
      const href = safeHref(original.getAttribute('href'));
      if (href === null) original.removeAttribute('href');
      else original.setAttribute('href', href);
    }
    if (normalizedElementName(original) === 'img') {
      const src = safeImgSrc(original.getAttribute('src'));
      if (src === null) original.removeAttribute('src');
      else original.setAttribute('src', src);
      const align = parseImageAlign(original as HTMLElement);
      if (align) original.setAttribute('data-align', align);
      else original.removeAttribute('data-align');
      for (const dimension of ['width', 'height'] as const) {
        const value = original.getAttribute(dimension);
        if (value !== null && !/^\d+$/.test(value)) original.removeAttribute(dimension);
      }
      const legacyAlign = original.getAttribute('align');
      if (legacyAlign !== null && !/^(left|right|center|middle)$/i.test(legacyAlign))
        original.removeAttribute('align');
    }
    if (normalizedElementName(original) === 'td' || normalizedElementName(original) === 'th') {
      for (const span of ['colspan', 'rowspan'] as const) {
        const kept = boundedInt(original.getAttribute(span), 1, 20);
        if (kept === null) original.removeAttribute(span);
        else original.setAttribute(span, kept);
      }
      const scope = original.getAttribute('scope');
      if (scope !== null && scope !== 'row' && scope !== 'col') original.removeAttribute('scope');
    }
    if (normalizedElementName(original) === 'ol') {
      const start = boundedInt(original.getAttribute('start'), 1, 10000);
      if (start === null) original.removeAttribute('start');
      else original.setAttribute('start', start);
      const type = original.getAttribute('type');
      if (type !== null && !/^[1aAiI]$/.test(type)) original.removeAttribute('type');
      if (start === '1') original.removeAttribute('start');
    }
    if (normalizedElementName(original) === 'li') {
      const value = boundedInt(original.getAttribute('value'), 1, 10000);
      if (value === null) original.removeAttribute('value');
      else original.setAttribute('value', value);
    }

    if (plan.styles || plan.borders) {
      const kept: string[] = [];
      for (const [property, value] of parseStyleDeclarations(
        original.getAttribute('style') ?? '',
      )) {
        if (!value) continue;
        // `background-color: transparent` (Google Docs writes it on every span) is a no-op,
        // not content: dropped here so it does not become a meaningless highlight mark.
        if (property === 'background-color' && value.toLowerCase() === 'transparent') continue;
        if (plan.borders && isBorderProp(property)) kept.push(`${property}: ${value}`);
        else if (plan.styles?.has(property)) kept.push(`${property}: ${value}`);
      }
      if (kept.length) original.setAttribute('style', kept.join('; '));
      else original.removeAttribute('style');
    } else if (plan.attrs !== null) {
      original.removeAttribute('style');
    }
  }

  for (const span of Array.from(root.querySelectorAll('span'))) {
    if (!span.isConnected) continue;
    if (span.attributes.length === 0) span.replaceWith(...Array.from(span.childNodes));
  }
}

// --- style carriers (ported; keeps any valid value instead of a fixed set) ------------

/**
 * Block content (tiptap T1 contract, adapted): textStyle marks parse from `span` (color,
 * font-size, font-family, letter-spacing, font-stretch), highlight from `mark`
 * (background-color), textAlign only from paragraph/heading nodes. Word commonly places
 * inherited text styles on a block, so the effective values are carried down to existing
 * inline carriers or synthesized around text leaves — otherwise ProseMirror's DOM parse
 * discards valid styling the schema could hold.
 */
interface ActiveInlineCarriers {
  color?: string;
  backgroundColor?: string;
  fontSize?: string;
  fontFamily?: string;
  letterSpacing?: string;
  fontStretch?: string;
}

const TEXT_STYLE_CARRIER_PROPS = new Set([
  'color',
  'font-family',
  'font-size',
  'letter-spacing',
  'font-stretch',
]);

const CARRIER_BLOCK_ELEMENTS = new Set([
  'blockquote',
  'caption',
  'div',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);

function carrierDecls(style: string | null): Map<string, string> {
  const declarations = new Map<string, string>();
  if (!style) return declarations;
  for (const [property, value] of parseStyleDeclarations(style)) {
    if (TEXT_STYLE_CARRIER_PROPS.has(property) || property === 'background-color') {
      // `transparent` is a no-op (Google Docs writes it everywhere), not a highlight.
      if (property === 'background-color' && value.toLowerCase() === 'transparent') continue;
      if (!declarations.has(property)) declarations.set(property, value);
    }
  }
  return declarations;
}

function applyCanonicalStyleCarriers(root: Element): void {
  const approvedStyles = new WeakMap<Element, Map<string, string>>();
  for (const element of Array.from(root.querySelectorAll('*'))) {
    if (element.tagName.toLowerCase() === 'div' && element.hasAttribute(RAW_HTML_ATTR)) continue;
    approvedStyles.set(element, carrierDecls(element.getAttribute('style')));
  }
  carryDown(root, approvedStyles, {}, {});
}

function carryDown(
  element: Element,
  approvedStyles: WeakMap<Element, Map<string, string>>,
  inherited: ActiveInlineCarriers,
  active: ActiveInlineCarriers,
): void {
  const own = approvedStyles.get(element) ?? new Map<string, string>();
  const effective: ActiveInlineCarriers = {
    color: own.get('color') ?? inherited.color,
    backgroundColor: own.get('background-color') ?? inherited.backgroundColor,
    fontSize: own.get('font-size') ?? inherited.fontSize,
    fontFamily: own.get('font-family') ?? inherited.fontFamily,
    letterSpacing: own.get('letter-spacing') ?? inherited.letterSpacing,
    fontStretch: own.get('font-stretch') ?? inherited.fontStretch,
  };
  const name = normalizedElementName(element);
  let nextActive = active;

  if (
    name === 'span' &&
    (effective.color ||
      effective.fontSize ||
      effective.fontFamily ||
      effective.letterSpacing ||
      effective.fontStretch)
  ) {
    element.setAttribute('style', textStyleDecl(effective, element));
    nextActive = {
      ...active,
      color: effective.color,
      fontSize: effective.fontSize,
      fontFamily: effective.fontFamily,
      letterSpacing: effective.letterSpacing,
      fontStretch: effective.fontStretch,
    };
  }
  if (name === 'mark' && effective.backgroundColor) {
    element.setAttribute(
      'style',
      `background-color: ${effective.backgroundColor}; color: inherit;`,
    );
    nextActive = { ...nextActive, backgroundColor: effective.backgroundColor };
  }

  // A cell consumes background-color as its own attribute: it must not flow into the
  // cell's content as a text highlight.
  const forChildren =
    name === 'td' || name === 'th' ? { ...effective, backgroundColor: undefined } : effective;
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 3) {
      if (child.textContent?.trim()) wrapTextWithCanonicalCarriers(child, forChildren, nextActive);
      continue;
    }
    if (!(child instanceof Element)) continue;
    if (child.tagName.toLowerCase() === 'div' && child.hasAttribute(RAW_HTML_ATTR)) continue;
    carryDown(
      child,
      approvedStyles,
      forChildren,
      CARRIER_BLOCK_ELEMENTS.has(normalizedElementName(child)) ? {} : nextActive,
    );
  }
}

function wrapTextWithCanonicalCarriers(
  textNode: ChildNode,
  effective: ActiveInlineCarriers,
  active: ActiveInlineCarriers,
): void {
  const needsTextStyle =
    (effective.color && effective.color !== active.color) ||
    (effective.fontSize && effective.fontSize !== active.fontSize) ||
    (effective.fontFamily && effective.fontFamily !== active.fontFamily) ||
    (effective.letterSpacing && effective.letterSpacing !== active.letterSpacing) ||
    (effective.fontStretch && effective.fontStretch !== active.fontStretch);
  const needsHighlight =
    effective.backgroundColor && effective.backgroundColor !== active.backgroundColor;
  if (!needsTextStyle && !needsHighlight) return;

  let root: Element | null = null;
  let leaf: Element | null = null;
  const document = textNode.ownerDocument;
  if (!document) return;
  if (needsTextStyle) {
    const span = document.createElement('span');
    span.setAttribute('style', textStyleDecl(effective));
    root = span;
    leaf = span;
  }
  if (needsHighlight) {
    const mark = document.createElement('mark');
    mark.setAttribute('style', `background-color: ${effective.backgroundColor}; color: inherit;`);
    if (leaf) leaf.append(mark);
    else root = mark;
    leaf = mark;
  }

  textNode.parentNode?.insertBefore(root!, textNode);
  leaf!.append(textNode);
}

function textStyleDecl(effective: ActiveInlineCarriers, keepOn?: Element): string {
  const parts: string[] = [];
  if (effective.color) parts.push(`color: ${effective.color};`);
  if (effective.fontFamily) parts.push(`font-family: ${effective.fontFamily};`);
  if (effective.fontSize) parts.push(`font-size: ${effective.fontSize};`);
  if (effective.letterSpacing) parts.push(`letter-spacing: ${effective.letterSpacing};`);
  if (effective.fontStretch) parts.push(`font-stretch: ${effective.fontStretch};`);
  if (keepOn) {
    for (const [property, value] of parseStyleDeclarations(keepOn.getAttribute('style') ?? '')) {
      if (
        (property === 'text-decoration' || property === 'vertical-align') &&
        !parts.some((part) => part.startsWith(`${property}:`))
      ) {
        parts.push(`${property}: ${value};`);
      }
    }
  }
  return parts.join(' ');
}

// --- embeds ----------------------------------------------------------------------------------

/**
 * Policy-allowed embeds are kept as a `rawHtml` block (placeholder form) instead of being
 * dropped — this closes the "a pasted bare `<iframe>` is dropped" gap. Disallowed ones are
 * left in place for the policy plugin to remove and report. Without the `rawHtml` node in the schema
 * there is nothing to keep them as, so they are dropped and reported.
 */
function wrapEmbeds(
  root: Element,
  options: NormalizePastedHtmlOptions,
  dropped: PasteDropped[],
): void {
  const hasRawHtml = !!options.schema.nodes['rawHtml'];
  const policy = options.policy ?? 'sanitize';
  const hosts = new Set((options.iframeHosts ?? DEFAULT_IFRAME_HOSTS).map((h) => h.toLowerCase()));
  for (const element of Array.from(root.querySelectorAll('iframe, object, embed'))) {
    if (!element.isConnected) continue;
    // Under `'sanitize'` an off-host embed stays as-is for the policy plugin to remove and
    // report (wrapping it would leave an empty `rawHtml` block once the policy cleans it).
    const src = element.getAttribute(element.localName === 'object' ? 'data' : 'src') ?? '';
    if (policy === 'sanitize' && !isAllowedIframeSrc(src, hosts)) continue;
    if (!hasRawHtml) {
      dropped.push({
        tag: normalizedElementName(element),
        reason: 'ignored',
        html: snippet(element.outerHTML),
      });
      element.remove();
      continue;
    }
    const holder = element.ownerDocument.createElement('div');
    holder.innerHTML = rawHtmlPlaceholder(element.outerHTML);
    element.replaceWith(...Array.from(holder.childNodes));
  }
}

/**
 * Normalize pasted HTML to what the editor schema can parse: Word/HWP junk removal, Word list
 * reconstruction, per-source mapping (clipboard class rules inlined, `mso-*` declarations
 * mapped, Google Docs' wrapper stripped, shorthand folds), schema allowlist (unknown wrappers
 * unwrapped, dangerous elements dropped and reported), and style carriers. The HTML security
 * policy still runs after (it stays the last word), so this keeps structure, not trust.
 */
export function normalizePastedHtml(
  html: string,
  options: NormalizePastedHtmlOptions,
): NormalizePastedHtmlResult {
  const dropped: PasteDropped[] = [];
  if (!html) return { html, dropped };
  if (typeof DOMParser === 'undefined') return { html, dropped };
  let document: Document;
  try {
    document = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return { html, dropped };
  }
  const source = classifyClipboardSource(html, document);
  // Class rules are harvested before comment removal: Word wraps sheets in conditional comments.
  const classRules =
    source.word || source.hwp
      ? collectClipboardClassRules(document)
      : new Map<string, ClipboardClassRule[]>();
  removeComments(document);
  if (classRules.size) inlineClipboardClassRules(document, classRules);
  removeOfficeNoise(document);
  if (source.word) normalizeWordLists(document.body);
  if (source.word || source.hwp) mapOfficeInlineStyles(document.body);
  unwrapWeightlessBold(document.body);
  foldInlineWeightStyles(document.body);
  wrapEmbeds(document.body, options, dropped);
  foldTableCellStyles(document.body);
  sanitizeElements(document.body, dropped);
  for (const leftover of Array.from(document.head.querySelectorAll('script, style'))) {
    dropped.push({
      tag: normalizedElementName(leftover),
      reason: 'ignored',
      html: snippet(leftover.outerHTML),
    });
    leftover.remove();
  }
  document.head.textContent = '';
  return { html: document.body.innerHTML, dropped };
}

/**
 * Source-side view of a clipboard payload for preservation measurement (report): the same
 * parse and pre-schema transforms `normalizePastedHtml` applies — class rules inlined, Office
 * `mso-*` declarations mapped, Word list reconstruction, cell and `<font>` folds — minus the
 * schema allowlist, style carriers and cleanup. Attribute readers on this document see exactly
 * what the clipboard carries, so the gap to `getJSON()` measures what the paste pipeline keeps.
 * Never trusts the payload: only used for reading, never rendered.
 */
export function prepareClipboardSourceDocument(html: string): Document | null {
  if (!html || typeof DOMParser === 'undefined') return null;
  let document: Document;
  try {
    document = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return null;
  }
  const source = classifyClipboardSource(html, document);
  const classRules =
    source.word || source.hwp
      ? collectClipboardClassRules(document)
      : new Map<string, ClipboardClassRule[]>();
  removeComments(document);
  if (classRules.size) inlineClipboardClassRules(document, classRules);
  removeOfficeNoise(document);
  if (source.word) normalizeWordLists(document.body);
  if (source.word || source.hwp) mapOfficeInlineStyles(document.body);
  foldTableCellStyles(document.body);
  for (const font of Array.from(document.body.querySelectorAll('font'))) foldFontElement(font);
  return document;
}
