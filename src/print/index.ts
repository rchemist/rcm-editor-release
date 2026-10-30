// Print HTML renderer: framework-free, static, no scripts.
//
// `renderPrintHtml()` turns a document JSON into one self-contained HTML document for the
// PDF server (server-side Chromium): the body is exactly what the editor's `getHTML()`
// produces for the same JSON — headless `generateHTML`-equivalent through the given
// extensions, with `rawHtml` placeholders expanded by the same `expandRawHtmlPlaceholders()`
// — wrapped in the editor's content root class (`.rcm-editor`), styled by the same content
// rules as `styles.css` (single source `src/styles/content.css`, embedded via the generated
// module `./printCss.generated`). Print is static: even under `trusted` no `<script>` is
// emitted (removals are reported as `script` in `report.policyRemoved`).
import { getHTMLFromFragment, getSchema } from '@tiptap/core';
import type { Extensions, JSONContent } from '@tiptap/core';
import { Node } from '@tiptap/pm/model';
import type { Schema } from '@tiptap/pm/model';
import { createEditorExtensions } from '../schema/kit';
import { expandRawHtmlPlaceholders } from '../extensions/rawHtml';
import { patchHtmlSerializer } from '../extensions/htmlFidelity';
import { sanitizeRawHtmlPlaceholders } from '../html/preserve';
import { DEFAULT_IFRAME_HOSTS } from '../html/policy';
import type { HtmlPolicy, PolicyRemovedEntry } from '../html/policy';
import { PRINT_CONTENT_CSS, PRINT_TOKENS_CSS } from './printCss.generated';

export const VERSION_MARKER = './print';
export { fontCss } from './fontCss';
export type { FontCssFamily, FontCssOptions } from './fontCss';

/** Page size: a name or an explicit `size` pair (CSS lengths, e.g. `{ width: '210mm', height: '297mm' }`). */
export type PrintPage = 'A4' | 'Letter' | { width: string; height: string };

/** Page margins: one CSS length for all sides, or per-side lengths. */
export type PrintMargins = string | { top: string; right: string; bottom: string; left: string };

/** Page/typography options shared by `renderPrintHtml()` and `printCss()`. */
export interface PrintLayoutOptions {
  /** Default `'A4'`. */
  page?: PrintPage;
  /** CSS lengths, default `'20mm'`. */
  margins?: PrintMargins;
  /** Plain text, repeated at the top of each page via an `@page` margin box (escaped, never HTML). */
  header?: string;
  /** Plain text; `{page}` / `{pages}` become `counter(page)` / `counter(pages)`. */
  footer?: string;
  /** `@font-face` CSS (provides one); inserted verbatim in `<style>`. */
  fontCss?: string;
}

export interface RenderPrintHtmlOptions extends PrintLayoutOptions {
  /** `<title>`, escaped. Default `''`. */
  title?: string;
  /** Default `createEditorExtensions()` — the same schema as the editor. */
  extensions?: Extensions;
  /** Raw payloads go through this policy (default `'sanitize'`). */
  htmlPolicy?: HtmlPolicy;
  /** Hosts whose https `iframe` embeds the `sanitize` policy keeps. */
  iframeHosts?: string[];
  /** `<html lang>`. Default `'ko'`. */
  lang?: string;
}

export interface RenderPrintHtmlResult {
  html: string;
  report: { policyRemoved: PolicyRemovedEntry[] };
}

/** Escapes `&`, `<`, `>`, `"` for HTML text/attribute positions. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Escapes a value for a double-quoted CSS string (`content: "…"`): quotes/backslashes/line
 * breaks, and `<` (as `\3C `) so a header/footer can never break out of the `<style>`
 * element nor read as markup — plain text stays plain text.
 */
function escapeCssString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/</g, '\\3C ')
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, '\\A ');
}

/** A CSS length the print `@page` rule accepts; anything else would let the value leave `<style>`. */
const CSS_LENGTH = /^\d+(\.\d+)?(mm|cm|in|pt|pc|px)$/;

function cssLength(value: unknown, fallback: string): string {
  return typeof value === 'string' && CSS_LENGTH.test(value.trim()) ? value.trim() : fallback;
}

/** Page size: `'A4'`/`'Letter'` or two CSS lengths; invalid values fall back to A4. */
function pageSizeCss(page: PrintPage): string {
  if (page === 'A4' || page === 'Letter') return page;
  if (typeof page === 'object' && page) {
    const width = cssLength(page.width, '');
    const height = cssLength(page.height, '');
    if (width && height) return `${width} ${height}`;
  }
  return 'A4';
}

/** Margins: one CSS length or four; each invalid length falls back to `20mm`. */
function marginsCss(margins: PrintMargins): string {
  if (typeof margins === 'string') return cssLength(margins, '20mm');
  if (typeof margins !== 'object' || !margins) return '20mm';
  return [margins.top, margins.right, margins.bottom, margins.left]
    .map((side) => cssLength(side, '20mm'))
    .join(' ');
}

/**
 * `fontCss` goes into `<style>` as-is apart from `<`: escaped (`\3C `, valid inside CSS strings
 * and urls, meaningless elsewhere) so a value can never close the stylesheet.
 */
function styleSafe(css: string): string {
  return css.replace(/</g, '\\3C ');
}

/** Builds the `content` value for the footer margin box (`{page}`/`{pages}` → counters). */
function footerContentCss(footer: string): string {
  const parts: string[] = [];
  const pushText = (text: string) => {
    if (text) parts.push(`"${escapeCssString(text)}"`);
  };
  const token = /\{(pages?)\}/g;
  let last = 0;
  for (let match = token.exec(footer); match; match = token.exec(footer)) {
    pushText(footer.slice(last, match.index));
    parts.push(match[1] === 'page' ? 'counter(page)' : 'counter(pages)');
    last = match.index + match[0].length;
  }
  pushText(footer.slice(last));
  return parts.length ? parts.join(' ') : '""';
}

function pageCss(options: PrintLayoutOptions): string {
  const size = pageSizeCss(options.page ?? 'A4');
  const margins = marginsCss(options.margins ?? '20mm');
  let css = `@page {\n  size: ${size};\n  margin: ${margins};\n`;
  if (options.header !== undefined && options.header !== '')
    css += `  @top-center {\n    content: "${escapeCssString(options.header)}";\n  }\n`;
  if (options.footer !== undefined && options.footer !== '')
    css += `  @bottom-center {\n    content: ${footerContentCss(options.footer)};\n  }\n`;
  css += '}\n';
  return css;
}

/** Print pagination rules (Chromium on the PDF server paginates on these). */
const PRINT_TABLE_CSS =
  'thead {\n  display: table-header-group;\n}\ntr {\n  break-inside: avoid;\n}\n';

/** Print root: flat paper surface on the light tokens (dark mode stays out of print). */
const PRINT_ROOT_CSS =
  '.rcm-editor {\n' +
  '  font-family: var(--rcm-editor-font-family);\n' +
  '  font-size: var(--rcm-editor-font-size);\n' +
  '  line-height: var(--rcm-editor-line-height);\n' +
  '  color: #000;\n' +
  '  background: #fff;\n' +
  '}\n';

/**
 * The print CSS alone, for consumers that assemble their own page: the given `fontCss`
 * `@font-face` rules, the light editor tokens, the shared content rules (same source as
 * `styles.css`), the `@page` size/margin/header/footer rules and the table pagination rules.
 * No `<script>`, no external `<link>`/`@import` — CSS only.
 */
export function printCss(options: PrintLayoutOptions = {}): string {
  const family = options.fontCss ? firstFontFaceFamily(options.fontCss) : null;
  return (
    (options.fontCss ? `${styleSafe(options.fontCss)}\n` : '') +
    `${family ? preferFamily(PRINT_TOKENS_CSS, family) : PRINT_TOKENS_CSS}\n${PRINT_CONTENT_CSS}\n${PRINT_ROOT_CSS}${PRINT_TABLE_CSS}${pageCss(options)}` +
    (family ? marginBoxFontCss(family) : '')
  );
}

/** Font-variable tokens the print root reads (body, code, math text). */
const FONT_TOKENS = [
  '--rcm-editor-font-family',
  '--rcm-editor-font-mono',
  '--rcm-editor-font-math',
];

/** First `font-family` an `@font-face` rule in `fontCss` declares, unquoted. */
function firstFontFaceFamily(fontCss: string): string | null {
  const match = /@font-face\s*{[^}]*?font-family\s*:\s*(['"]?)([^;'"}]+)\1/i.exec(fontCss);
  return match?.[2]?.trim() || null;
}

const cssString = (value: string): string =>
  `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/</g, '\\3C ')}'`;

/**
 * The token stacks name system fonts only (`system-ui, …`), so the server's Chromium would
 * fall back to whatever CJK font its image has instead of the shipped `fontCss` families.
 * The first declared family goes in front; the original stack stays
 * behind it for glyphs the family lacks.
 */
function preferFamily(tokensCss: string, family: string): string {
  let out = tokensCss;
  for (const name of FONT_TOKENS)
    out = out.replace(new RegExp(`(${name}\\s*:\\s*)`, 'g'), `$1${cssString(family)}, `);
  return out;
}

/** Margin-box text (header/footer) does not inherit the page's font variables. */
function marginBoxFontCss(family: string): string {
  const decl = `font-family: ${cssString(family)}, sans-serif;`;
  return `@page {\n  @top-center { ${decl} }\n  @bottom-center { ${decl} }\n}\n`;
}

/**
 * Moves each table's leading all-`th` row into a `thead`: the editor renders header rows as
 * `tbody > tr > th`, so `thead { display: table-header-group }` would never apply and Chromium
 * would not repeat the header on every page. Print-only; `getHTML()` is unchanged.
 */
function hoistHeaderRows(parsed: Document): void {
  for (const table of [...parsed.body.querySelectorAll('table')]) {
    if (table.tHead) continue;
    const body = table.tBodies[0];
    const first = body?.rows[0];
    if (!body || !first || !first.cells.length) continue;
    if (![...first.cells].every((cell) => cell.tagName === 'TH')) continue;
    const thead = parsed.createElement('thead');
    thead.append(first);
    table.insertBefore(thead, body);
  }
}

type JsonNode = {
  type?: unknown;
  attrs?: unknown;
  marks?: { type?: unknown }[];
  content?: JsonNode[];
};

/**
 * Drops what the schema cannot load, so `Node.fromJSON` never throws: nodes of an unknown
 * type print as nothing (their subtree goes with them), marks of an unknown type are removed
 * (their content stays). Known content passes through untouched (same object references).
 */
function stripUnknown(node: JsonNode, schema: Schema): JsonNode | null {
  if (typeof node.type !== 'string' || !schema.nodes[node.type]) return null;
  const out: JsonNode = { ...node };
  if (Array.isArray(node.marks))
    out.marks = node.marks.filter(
      (mark) => typeof mark?.type === 'string' && schema.marks[mark.type],
    );
  if (Array.isArray(node.content)) {
    const kept: JsonNode[] = [];
    for (const child of node.content) {
      const clean = stripUnknown(child, schema);
      if (clean) kept.push(clean);
    }
    out.content = kept;
  }
  return out;
}

/** URL attributes that load or navigate; a script scheme in any of them is removed. */
const URL_ATTRS = [
  'src',
  'href',
  'xlink:href',
  'action',
  'formaction',
  'data',
  'poster',
  'background',
];
const SCRIPT_URL = /^(javascript|vbscript|data:text\/html)/i;

/**
 * Always re-serializes the expanded body through the DOM (print is static, so the bytes need
 * not match the input): stray end tags in a raw payload cannot leave the body wrapper, every
 * `<script>` is removed and reported as `script`, and a script-scheme URL on any element
 * (image `src` included — the editor's `getHTML()` keeps it) is removed and reported.
 */
function cleanPrintBody(html: string): { html: string; removed: PolicyRemovedEntry[] } {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const removed: PolicyRemovedEntry[] = [];
  const push = (entry: PolicyRemovedEntry): void => {
    if (removed.length < 500) removed.push(entry);
  };
  for (const script of [...parsed.querySelectorAll('script')]) {
    push({ kind: 'script', detail: script.outerHTML.slice(0, 200) });
    script.remove();
  }
  for (const el of [...parsed.body.querySelectorAll('*')]) {
    for (const name of URL_ATTRS) {
      const value = el.getAttribute(name);
      // Same normalization browsers apply before reading a scheme: controls and spaces go.
      if (value == null) continue;
      const bare = [...value].filter((c) => c.charCodeAt(0) > 0x20 && c.charCodeAt(0) !== 0x7f);
      if (!SCRIPT_URL.test(bare.join(''))) continue;
      push({ kind: 'javascript-url', detail: `<${el.localName} ${name}="${value.slice(0, 80)}">` });
      el.removeAttribute(name);
    }
  }
  hoistHeaderRows(parsed);
  return { html: parsed.body.innerHTML, removed };
}

/**
 * Renders `doc` to one self-contained print HTML document. The body is the editor's
 * `getHTML()` output for the same JSON (headless `generateHTML`-equivalent through
 * `options.extensions`, `rawHtml` placeholders expanded to their payload exactly like
 * `getHTML()`) inside `<div class="rcm-editor"><div class="ProseMirror">…</div></div>`.
 * Raw payloads pass through `htmlPolicy` (same placeholder sanitizer as the load path);
 * scripts are then removed unconditionally and reported as `script`. Images keep their
 * `src` (`data:` URLs and URLs pass through; server network restrictions are the PDF server's concern).
 */
export function renderPrintHtml(
  doc: JSONContent,
  options: RenderPrintHtmlOptions = {},
): RenderPrintHtmlResult {
  const {
    title = '',
    extensions = createEditorExtensions(),
    htmlPolicy = 'sanitize',
    iframeHosts = [...DEFAULT_IFRAME_HOSTS],
    lang = 'ko',
  } = options;
  const schema = getSchema(extensions);
  // Same serializer patch the editor's `getHTML()` runs under (`HtmlFidelity`): inline styles
  // exactly as rendered, literal tabs kept. `fromSchema` caches per schema, so the instance
  // `getHTMLFromFragment` below uses is the patched one.
  patchHtmlSerializer(schema);
  const clean = stripUnknown((doc ?? {}) as JsonNode, schema) ?? { type: 'doc' };
  const serialized = getHTMLFromFragment(Node.fromJSON(schema, clean).content, schema);
  const { html: policied, removed: policyRemoved } = sanitizeRawHtmlPlaceholders(serialized, {
    policy: htmlPolicy,
    iframeHosts,
    source: 'initial',
  });
  // The PDF server's Chromium renders this document: whatever the editor's policy allowed
  // (`trusted`, a function), print never carries executable content — `sanitize`-level removal
  // (scripts, `on*` handlers, `javascript:` URLs, off-host embeds) always runs on raw payloads.
  const net =
    htmlPolicy === 'sanitize'
      ? { html: policied, removed: [] }
      : sanitizeRawHtmlPlaceholders(policied, {
          policy: 'sanitize',
          iframeHosts,
          source: 'initial',
        });
  policyRemoved.push(...net.removed);
  const expanded = expandRawHtmlPlaceholders(net.html);
  const { html: body, removed: scripts } = cleanPrintBody(expanded);
  return {
    html:
      '<!doctype html>\n' +
      `<html lang="${escapeHtml(lang)}">\n` +
      '<head>\n' +
      '<meta charset="utf-8">\n' +
      `<title>${escapeHtml(title)}</title>\n` +
      '<style>\n' +
      `${printCss(options)}\n` +
      '</style>\n' +
      '</head>\n' +
      '<body>\n' +
      `<div class="rcm-editor"><div class="ProseMirror">${body}</div></div>\n` +
      '</body>\n' +
      '</html>\n',
    report: { policyRemoved: [...policyRemoved, ...scripts] },
  };
}
