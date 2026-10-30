// HTML input security policy (`htmlPolicy`).
//
// - `'sanitize'` (default): removes `script` elements, `on*` attributes, `javascript:` /
//   `vbscript:` (and `data:text/html`) URLs, `iframe`s whose src is not an https URL on
//   `iframeHosts`, `srcdoc` on iframes, `<meta http-equiv="refresh">`, SVG animations that
//   animate a link `href` to a dangerous URL, and off-host `object[data]`/`embed[src]`.
//   Everything else —
//   `style`, `class`, `id`, `data-*`, `meta`, `link`, `base`, custom elements — is kept
//   verbatim so the preservation step can wrap it in `rawHtml` instead of losing it.
// - `'trusted'`: integration-developer opt-in, the input passes through untouched (scripts
//   included). The server must validate again (see README).
// - `(html, ctx) => string`: the return value is used as the policy result.
//
// Removal reporting: every removal is recorded in `PolicyRemovedEntry[]` (nothing is removed
// silently). When nothing is removed the input string is returned unchanged (byte-identical),
// which is what `getLosslessHTML` hands back for unedited documents.
import createDOMPurify from 'dompurify';
import type { Config as DOMPurifyConfig, DOMPurify as DOMPurifyInstance } from 'dompurify';
import { RAW_HTML_ATTR } from '../extensions/rawHtml';

/** HTML input security policy (component prop `htmlPolicy`, core option `htmlPolicy`). */
export type HtmlPolicy = 'sanitize' | 'trusted' | HtmlPolicyFn;

/** Consumer policy function: its return value is used as the policy result. */
export type HtmlPolicyFn = (html: string, ctx: HtmlPolicyContext) => string;

export interface HtmlPolicyContext {
  source: 'initial' | 'setContent' | 'insertContent';
}

export type PolicyRemovedKind =
  'script' | 'event-handler' | 'javascript-url' | 'iframe-host' | 'other';

export interface PolicyRemovedEntry {
  kind: PolicyRemovedKind;
  detail: string;
}

/** Default `iframeHosts`: YouTube and Vimeo https embeds. */
export const DEFAULT_IFRAME_HOSTS: readonly string[] = [
  'www.youtube.com',
  'www.youtube-nocookie.com',
  'player.vimeo.com',
];

export interface ApplyPolicyOptions {
  policy?: HtmlPolicy;
  iframeHosts?: string[];
  source: HtmlPolicyContext['source'];
}

export interface ApplyPolicyResult {
  /** The policy result: `input` itself when nothing was removed. */
  html: string;
  removed: PolicyRemovedEntry[];
}

const SNIPPET = 200;
const snippet = (value: string): string =>
  value.length > SNIPPET ? `${value.slice(0, SNIPPET)}…` : value;

/** URL-bearing attribute names the policy inspects. */
const URL_ATTRS = new Set([
  'href',
  'src',
  'xlink:href',
  'action',
  'formaction',
  'cite',
  'poster',
  'background',
  'data',
  'codebase',
]);

/** Tags whose `src`-like attributes may legitimately hold `data:` URLs (base64 media). */
const MEDIA_TAGS = new Set(['img', 'video', 'audio', 'source', 'image', 'track']);

/**
 * SMIL animation elements: `attributeName="href"` plus `values`/`to` can animate a link to a
 * `javascript:` URL mid-document. Their URL-bearing attributes are not plain URL
 * attributes, so they get their own check.
 */
const ANIMATION_TAGS = new Set([
  'animate',
  'animatetransform',
  'animatemotion',
  'animatecolor',
  'set',
]);
/** Link attributes an animation may target. */
const ANIMATABLE_HREFS = new Set(['href', 'xlink:href']);
/** Attributes of an animation element that can carry the animated URL value. */
const ANIMATION_URL_ATTRS = ['values', 'to', 'from', 'by'] as const;

/** Strips ASCII tab/newline (browsers drop them before parsing URLs: `java\tscript:` runs). */
const decontrol = (value: string): string => value.replace(/[\t\n\r]/g, '');

/**
 * Leading C0 controls and spaces are ignored by URL parsers (WHATWG URL strip set), so they
 * are removed before matching the scheme. A plain loop: the range starts at U+0000, which the
 * `no-control-regex` rule bans in regex literals.
 */
const stripLeadingC0OrSpace = (value: string): string => {
  let i = 0;
  while (i < value.length && (value.charCodeAt(i) as number) <= 0x20) i++;
  return value.slice(i);
};
const schemeOf = (value: string): string => {
  const clean = stripLeadingC0OrSpace(decontrol(value));
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(clean);
  return (match?.[1] ?? '').toLowerCase();
};

const DANGEROUS_SCHEMES = new Set(['javascript', 'vbscript']);

/** True for URL values the policy removes (and reports as `javascript-url`). */
function isDangerousUrl(tag: string, attr: string, value: string): boolean {
  const scheme = schemeOf(value);
  if (DANGEROUS_SCHEMES.has(scheme)) return true;
  if (scheme !== 'data') return false;
  const clean = stripLeadingC0OrSpace(decontrol(value));
  if (/^data:text\/html/i.test(clean)) return true;
  // `data:` elsewhere than media `src` is a navigation/render vector: only media keeps it
  // (base64 images), everything else is removed.
  return !(MEDIA_TAGS.has(tag) && attr === 'src');
}

/** True when `el` is an animation element whose target attribute is a link URL (`href`). */
function animatesLinkHref(el: Element | null): boolean {
  const target = el?.getAttribute('attributeName')?.trim().toLowerCase() ?? '';
  return ANIMATABLE_HREFS.has(target);
}

/** An animation URL attribute value; `values` is a semicolon-separated list, every segment must be safe. */
function dangerousAnimationValue(tag: string, attr: string, value: string): boolean {
  if (attr !== 'values') return isDangerousUrl(tag, attr, value);
  return value.split(';').some((segment) => isDangerousUrl(tag, attr, segment.trim()));
}

function parseDocument(input: string): Document | null {
  try {
    if (typeof DOMParser === 'undefined') return null;
    return new DOMParser().parseFromString(input, 'text/html');
  } catch {
    return null;
  }
}

/** Inner markup of head + body, in document order (fragments live in body; head holds leading meta/link). */
function fragmentOf(doc: Document): string {
  return `${doc.head.innerHTML}${doc.body.innerHTML}`;
}

interface NetSnapshot {
  /** Element counts by tag. */
  tags: Map<string, number>;
  /** Attribute occurrences by `tag\0name\0value` (multiset: repeated attrs count). */
  attrs: Map<string, number>;
  /** Comment occurrences by data (multiset). */
  comments: Map<string, number>;
}

/**
 * What the DOMPurify net pass starts from (taken after the precise pre-pass, so only net
 * losses are diffed): elements, every attribute with its value, and comments. Attribute *values*
 * matter because the net strips dangerous ones in place (`</iframe`, `-->` …), and comments
 * matter because conditional ones (MSO `<!--[if mso]>…`) carry content the schema can keep.
 */
function snapshotNet(root: ParentNode): NetSnapshot {
  const tags = new Map<string, number>();
  const attrs = new Map<string, number>();
  root.querySelectorAll('*').forEach((el) => {
    tags.set(el.tagName, (tags.get(el.tagName) ?? 0) + 1);
    const tag = el.tagName.toLowerCase();
    for (const attr of el.attributes) {
      const key = `${tag}\0${attr.name.toLowerCase()}\0${attr.value}`;
      attrs.set(key, (attrs.get(key) ?? 0) + 1);
    }
  });
  const comments = new Map<string, number>();
  const doc = root.ownerDocument ?? (root as Document);
  try {
    const filter =
      typeof NodeFilter !== 'undefined' ? NodeFilter.SHOW_COMMENT : (128 as unknown as number);
    const walker = doc.createTreeWalker(root, filter);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const data = node.textContent ?? '';
      comments.set(data, (comments.get(data) ?? 0) + 1);
    }
  } catch {
    // No DOM traversal available: comments stay invisible to the diff (elements still diff).
  }
  return { tags, attrs, comments };
}

interface PrePass {
  removed: PolicyRemovedEntry[];
}

/** Precise-kind removals on the live document: scripts, event handlers, dangerous URLs, bad iframes. */
function prePass(doc: Document, hosts: Set<string>): PrePass {
  const removed: PolicyRemovedEntry[] = [];
  const push = (kind: PolicyRemovedKind, detail: string) => {
    if (removed.length < 500) removed.push({ kind, detail: snippet(detail) });
  };

  for (const script of [...doc.querySelectorAll('script')]) {
    push('script', script.outerHTML);
    script.remove();
  }

  const elements = doc.querySelectorAll('*');
  elements.forEach((el) => {
    const tag = el.tagName.toLowerCase();
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (/^on/i.test(attr.name)) {
        push('event-handler', `<${tag} ${attr.name}>`);
        el.removeAttribute(attr.name);
      } else if (URL_ATTRS.has(name) || name.includes(':')) {
        if (isDangerousUrl(tag, name, attr.value)) {
          push('javascript-url', `<${tag} ${attr.name}="${attr.value.slice(0, 80)}">`);
          el.removeAttribute(attr.name);
        }
      }
    }
    if (tag === 'iframe') {
      const srcdoc = el.getAttribute('srcdoc');
      if (srcdoc !== null) {
        push('iframe-host', '<iframe srcdoc>');
        el.removeAttribute('srcdoc');
      }
      const src = el.getAttribute('src');
      if (src !== null && src !== '' && !isAllowedIframeSrc(src, hosts)) {
        push('iframe-host', `<iframe src="${src.slice(0, 120)}">`);
        el.remove();
      }
    } else if (tag === 'object' || tag === 'embed') {
      // Same embed boundary as iframes: `object[data]` / `embed[src]` render an external
      // document, so only listed https hosts stay.
      const name = tag === 'object' ? 'data' : 'src';
      const url = el.getAttribute(name);
      if (url !== null && url !== '' && !isAllowedIframeSrc(url, hosts)) {
        push('iframe-host', `<${tag} ${name}="${url.slice(0, 120)}">`);
        el.remove();
      }
    }
    if (ANIMATION_TAGS.has(tag) && animatesLinkHref(el)) {
      for (const attr of ANIMATION_URL_ATTRS) {
        const value = el.getAttribute(attr);
        if (value !== null && dangerousAnimationValue(tag, attr, value)) {
          push(
            'javascript-url',
            `<${tag} attributeName="${el.getAttribute('attributeName')}" ${attr}="${value.slice(0, 80)}">`,
          );
          el.removeAttribute(attr);
        }
      }
    }
    if (
      tag === 'meta' &&
      (el.getAttribute('http-equiv') ?? '').trim().toLowerCase() === 'refresh'
    ) {
      push('other', `<meta http-equiv="refresh" content="${el.getAttribute('content') ?? ''}">`);
      el.remove();
    }
  });
  return { removed };
}

export function isAllowedIframeSrc(src: string, hosts: Set<string>): boolean {
  let url: URL;
  try {
    url = new URL(decontrol(src));
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return hosts.has(url.hostname.toLowerCase());
}

// --- DOMPurify safety net ------------------------------------------------------------------
// The pre-pass above removes exactly the contract's categories. DOMPurify then re-parses and
// re-serializes as a net against mutation-XSS and vectors the pre-pass does not know, with hooks
// that keep everything the pre-pass kept: allow every element except `script`, force-keep every
// attribute except event handlers and dangerous URLs (DOMPurify's own allowlists would otherwise
// drop `meta`, custom elements and non-standard attributes).

let cachedPurify: { win: object; purify: DOMPurifyInstance } | null = null;

function purifier(): DOMPurifyInstance | null {
  try {
    if (typeof window === 'undefined') return null;
    if (!cachedPurify || cachedPurify.win !== window) {
      const purify = createDOMPurify(window as unknown as Parameters<typeof createDOMPurify>[0]);
      purify.addHook('uponSanitizeElement', (_node, data) => {
        if (data.tagName === 'script') return;
        data.allowedTags[data.tagName] = true;
      });
      purify.addHook('uponSanitizeAttribute', (_node, data) => {
        if (/^on/i.test(data.attrName)) {
          data.keepAttr = false;
          return;
        }
        const tag = ((_node as Element | null)?.tagName ?? '').toLowerCase();
        if (URL_ATTRS.has(data.attrName) || data.attrName.includes(':')) {
          if (isDangerousUrl(tag, data.attrName, data.attrValue)) {
            data.keepAttr = false;
            return;
          }
        }
        if (
          (ANIMATION_URL_ATTRS as readonly string[]).includes(data.attrName) &&
          ANIMATION_TAGS.has(tag) &&
          animatesLinkHref(_node as Element | null) &&
          dangerousAnimationValue(tag, data.attrName, data.attrValue)
        ) {
          data.keepAttr = false;
          return;
        }
        data.forceKeepAttr = true;
      });
      cachedPurify = { win: window, purify };
    }
    return cachedPurify.purify;
  } catch {
    return null;
  }
}

const purifyConfig: DOMPurifyConfig = { FORBID_TAGS: ['script'] };

// Tags DOMPurify drops before hooks run when they open the markup (its internal document
// assigns leading `meta`/`link`/`title`/`base`/`style` to `<head>` and serializes only the body):
// renamed aside before the net pass and renamed back after, so they survive verbatim.
const PROTECTED_TAGS = ['base', 'link', 'meta', 'title', 'style'] as const;
const VOID_PROTECTED = new Set(['base', 'link', 'meta']);

function protectTag(
  html: string,
  tag: (typeof PROTECTED_TAGS)[number],
): { html: string; token: string } {
  let token = `rcm-${tag}-protect`;
  for (let n = 1; html.includes(`<${token}`) || html.includes(`</${token}`); n++)
    token = `rcm-${tag}-protect-${n}`;
  const renamed = html.replace(new RegExp(`<(/?)${tag}(?=[\\s/>])`, 'gi'), `<$1${token}`);
  return { html: renamed, token };
}

function unprotectTag(html: string, tag: string, token: string): string {
  // Void elements serialize the renamed tag with a stray close tag (`<link>` → `<rcm-…></rcm-…>`);
  // drop it, otherwise rename it back (`</rcm-…>` → `</style>`).
  const withoutClose = VOID_PROTECTED.has(tag)
    ? html.replace(new RegExp(`</${token}\\s*>`, 'g'), '')
    : html;
  return withoutClose.replace(new RegExp(`<(/?)${token}(?=[\\s/>])`, 'g'), `<$1${tag}`);
}

/**
 * Shields `rawHtml` placeholder *payload values* from the DOMPurify net pass. DOMPurify strips
 * `data-*` attributes whose value holds `<iframe>` markup (an mXSS guard), which would destroy
 * placeholders carrying embeds, allowed hosts included. Only the attribute value is swapped
 * for an index token: the placeholder element and its children stay in the net pass, so the
 * net still sanitizes them. Payload values are cleaned by the dedicated payload sanitizer
 * (`sanitizePlaceholderPayloads`) with the real policy and hosts.
 */
function shieldPlaceholderValues(doc: Document): { prefix: string; values: string[] } | null {
  const elements = doc.querySelectorAll(`[${RAW_HTML_ATTR}]`);
  if (!elements.length) return null;
  const prefix = `rcm-ph-${Math.random().toString(36).slice(2)}-`;
  const values: string[] = [];
  elements.forEach((el) => {
    values.push(el.getAttribute(RAW_HTML_ATTR) ?? '');
    el.setAttribute(RAW_HTML_ATTR, `${prefix}${values.length - 1}`);
  });
  return { prefix, values };
}

/** Puts shielded payload values back; placeholders the net removed stay removed (diffed). */
function unshieldPlaceholderValues(
  out: string,
  shield: { prefix: string; values: string[] },
): string {
  const doc = parseDocument(out);
  if (!doc) return out;
  let changed = false;
  doc.querySelectorAll(`[${RAW_HTML_ATTR}]`).forEach((el) => {
    const value = el.getAttribute(RAW_HTML_ATTR) ?? '';
    if (!value.startsWith(shield.prefix)) return;
    const original = shield.values[Number(value.slice(shield.prefix.length))];
    if (original === undefined) return;
    el.setAttribute(RAW_HTML_ATTR, original);
    changed = true;
  });
  return changed ? fragmentOf(doc) : out;
}

function sanitizeWithDom(input: string, hosts: Set<string>): ApplyPolicyResult {
  const doc = parseDocument(input);
  if (!doc) return sanitizeWithoutDom(input, hosts);
  const { removed } = prePass(doc, hosts);

  const purify = purifier();
  // The net diff compares policy input vs policy output: snapshot before shielding (only
  // when placeholders are present — otherwise shielding leaves the document untouched and the
  // snapshot is taken lazily below).
  const shielded = !!purify && doc.querySelectorAll(`[${RAW_HTML_ATTR}]`).length > 0;
  const before = shielded ? snapshotNet(doc) : null;
  const shield = purify ? shieldPlaceholderValues(doc) : null;
  let out = fragmentOf(doc);
  if (purify) {
    const tokens: { tag: string; token: string }[] = [];
    for (const tag of PROTECTED_TAGS) {
      const next = protectTag(out, tag);
      out = next.html;
      tokens.push({ tag, token: next.token });
    }
    out = purify.sanitize(out, purifyConfig);
    for (const { tag, token } of tokens) out = unprotectTag(out, tag, token);
    if (shield) out = unshieldPlaceholderValues(out, shield);
    // Net-only losses (the pre-pass did not report them): report as `other`, never silently.
    // Elements, attribute values the net stripped in place, and removed comments (e.g. MSO
    // conditional comments) all diff — nothing the net drops goes unreported.
    const afterDoc = parseDocument(out);
    if (afterDoc) {
      const base = before ?? snapshotNet(doc);
      const after = snapshotNet(afterDoc);
      const missing = (
        counts: Map<string, number>,
        kept: Map<string, number>,
        detail: (key: string) => string,
      ): void => {
        for (const [key, n] of counts) {
          const left = n - (kept.get(key) ?? 0);
          for (let i = 0; i < left && removed.length < 500; i++)
            removed.push({ kind: 'other', detail: snippet(detail(key)) });
        }
      };
      missing(base.tags, after.tags, (tag) => `<${tag.toLowerCase()}> removed by sanitizer`);
      missing(base.attrs, after.attrs, (key) => {
        const [tag, name, value] = key.split('\0');
        return `<${tag} ${name}="${(value ?? '').slice(0, 80)}"> removed by sanitizer`;
      });
      missing(
        base.comments,
        after.comments,
        (data) => `<!--${data.slice(0, 80)}--> removed by sanitizer`,
      );
      // Anything the detectors still find in the output is removed here as a last resort. Runs
      // on the same parse as the diff (one parse of `out`, not two; the snapshot above is
      // already taken, so the pre-pass may mutate it).
      const again = prePass(afterDoc, hosts);
      for (const entry of again.removed) {
        if (removed.length < 500) removed.push({ ...entry, kind: 'other' });
      }
      if (again.removed.length) out = fragmentOf(afterDoc);
    }
  }
  if (!removed.length) return { html: input, removed };
  return { html: out, removed };
}

/** Best-effort fallback when no DOM is available (the editor itself needs a DOM to run). */
function sanitizeWithoutDom(input: string, hosts: Set<string>): ApplyPolicyResult {
  const removed: PolicyRemovedEntry[] = [];
  let out = input;
  out = out.replace(/<script[\s>][\s\S]*?<\/script\s*>/gi, (m) => {
    removed.push({ kind: 'script', detail: snippet(m) });
    return '';
  });
  out = out.replace(/<script[^>]*\/>/gi, (m) => {
    removed.push({ kind: 'script', detail: snippet(m) });
    return '';
  });
  out = out.replace(/\son[a-zA-Z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g, (m) => {
    removed.push({ kind: 'event-handler', detail: snippet(m.trim()) });
    return '';
  });
  out = out.replace(
    /\s(href|src|xlink:href|action|formaction|cite)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
    (m, _name, value: string) => {
      const unquoted = value.replace(/^['"]|['"]$/g, '');
      const stripped = stripLeadingC0OrSpace(decontrol(unquoted));
      if (/^(javascript|vbscript|data:text\/html)/i.test(stripped)) {
        removed.push({ kind: 'javascript-url', detail: snippet(m.trim()) });
        return '';
      }
      return m;
    },
  );
  out = out.replace(/<iframe[\s>][\s\S]*?(<\/iframe\s*>|>)/gi, (m) => {
    const src =
      /src\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i.exec(m)?.[1]?.replace(/^['"]|['"]$/g, '') ?? '';
    if (src !== '' && !isAllowedIframeSrc(src, hosts))
      removed.push({ kind: 'iframe-host', detail: snippet(m.slice(0, 120)) });
    else if (src === '')
      removed.push({ kind: 'iframe-host', detail: '<iframe> (no DOM: dropped)' });
    else return m;
    return '';
  });
  if (!removed.length) return { html: input, removed };
  return { html: out, removed };
}

/** Applies `policy` to `input` (see module docs). Never throws for `'sanitize'`/`'trusted'`. */
export function applyHtmlPolicy(input: string, options: ApplyPolicyOptions): ApplyPolicyResult {
  const { policy = 'sanitize', iframeHosts = DEFAULT_IFRAME_HOSTS, source } = options;
  if (typeof policy === 'function') return { html: policy(input, { source }), removed: [] };
  if (policy === 'trusted') return { html: input, removed: [] };
  return sanitizeWithDom(input, new Set(iframeHosts.map((h) => h.toLowerCase())));
}
