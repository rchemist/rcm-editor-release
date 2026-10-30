import { getStyleProperty } from '@tiptap/core';

/** Units the indent arithmetic understands. Other units are preserved but not stepped. */
export type LengthUnit = 'pt' | 'px';

export interface Length {
  value: number;
  unit: LengthUnit;
}

const LENGTH_RE = /^(-?\d+(?:\.\d+)?|-?\.\d+)(pt|px)?$/;

/** Parses `"10pt"` / `"13.33px"` / `"0"`. Returns null for other units or malformed input. */
export function parseLength(raw: string | null | undefined): Length | null {
  if (raw == null) return null;
  const m = LENGTH_RE.exec(raw.trim());
  if (!m) return null;
  const value = Number(m[1]);
  const unit = m[2] as LengthUnit | undefined;
  if (!unit) return value === 0 ? { value: 0, unit: 'pt' } : null;
  return { value, unit };
}

/** docparser format: at most two decimals, trailing zeros dropped (`"10pt"`, `"13.33px"`). */
export function formatLength({ value, unit }: Length): string {
  const rounded = Math.round(value * 100) / 100;
  return `${Object.is(rounded, -0) ? 0 : rounded}${unit}`;
}

/** Converts `length` to `unit` (1pt = 4/3 px), rounded to two decimals. */
export function convertLength(length: Length, unit: LengthUnit): Length {
  if (length.unit === unit) return length;
  const value = unit === 'px' ? (length.value * 4) / 3 : length.value * 0.75;
  return { value: Math.round(value * 100) / 100, unit };
}

/** Raw inline-style value (no canonicalisation), or null when absent/empty. */
export function readStyle(element: HTMLElement, property: string): string | null {
  const value = getStyleProperty(element, property);
  return value ? value : null;
}

/**
 * What may not appear in a value written into a `style` attribute: declaration/rule breakers
 * (`;`, `{`, `}`, newlines), CSS escapes (`\`, which can spell any of these), comments, and
 * anything that loads or runs something (`url(`, `image-set(`, `image(`, `cross-fade(`,
 * `element(`, `src(`, `paint(`, `expression(`, `javascript:`, `@import`, `behavior:`).
 */
const UNSAFE_CSS_VALUE_RE =
  /[;{}\\\n\r\f]|\/\*|@import|javascript:|behavior\s*:|(?:url|image|image-set|-webkit-image-set|cross-fade|-webkit-cross-fade|element|-moz-element|src|paint|expression)\s*\(/i;

/** Dangerous fragments only (no `;`): for checking a whole, already-joined declaration list. */
const UNSAFE_CSS_DECL_RE =
  /[{}\\]|\/\*|@import|javascript:|behavior\s*:|(?:url|image|image-set|-webkit-image-set|cross-fade|-webkit-cross-fade|element|-moz-element|src|paint|expression)\s*\(/i;

/**
 * `value` when it can be written into one inline style declaration safely, else null. Attribute
 * values stay as they are in the JSON (lossless); unsafe ones are just not rendered. Font stacks
 * with quotes and commas, `rgb()`, `calc()`, `var()` and the like pass.
 */
export function safeCssValue(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return UNSAFE_CSS_VALUE_RE.test(value) ? null : value;
}

/**
 * Inline style with every declaration that could load or run something removed (defence in
 * depth for styles already joined from several attributes; `safeCssValue` is the per-value
 * check). Declarations are kept byte for byte.
 */
export function sanitizeStyle(style: string): string {
  if (!UNSAFE_CSS_DECL_RE.test(style) && !/[\n\r\f]/.test(style)) return style;
  return style
    .split(/;|[\n\r\f]/)
    .filter((decl) => decl.trim() !== '' && !UNSAFE_CSS_DECL_RE.test(decl))
    .map((decl) => decl.trim())
    .join('; ');
}

/** renderHTML helper: forwards a pre-formatted string into one style declaration (if safe). */
export function styleDecl(property: string, value: unknown): Record<string, string> {
  const safe = safeCssValue(value);
  return safe ? { style: `${property}: ${safe}` } : {};
}

/** Blank / whitespace-only values (what `element.style.x` returns when unset) become null. */
export function emptyToNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

const RGB_RE =
  /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:\s*[,/]\s*(1|1\.0+|100%))?\s*\)$/i;

/**
 * docparser colour format: lowercase `#rrggbb`. Browsers canonicalise inline colours to
 * `rgb(r, g, b)` when ProseMirror writes `style.cssText`, so opaque rgb()/rgba() is folded back
 * to hex; hex is lowercased; anything else (named, translucent, var()) is kept as given.
 */
export function normalizeColor(value: unknown): string | null {
  const raw = emptyToNull(value)?.trim();
  if (!raw) return null;
  if (/^#[0-9a-f]{3,8}$/i.test(raw)) return raw.toLowerCase();
  const m = RGB_RE.exec(raw);
  if (!m) return raw;
  const channels = [m[1], m[2], m[3]].map(Number);
  if (channels.some((c) => c > 255)) return raw;
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export type MarginSide = 'top' | 'right' | 'bottom' | 'left';

/**
 * Raw value of `margin-<side>`: the longhand when present, otherwise the matching component of
 * the `margin` shorthand (browsers collapse four longhands into it when serialising).
 */
export function readMargin(element: HTMLElement, side: MarginSide): string | null {
  const longhand = readStyle(element, `margin-${side}`);
  if (longhand) return longhand;
  const shorthand = readStyle(element, 'margin');
  if (!shorthand) return null;
  const parts = shorthand
    .replace(/\s*!important\s*$/i, '')
    .trim()
    .split(/\s+/);
  if (parts.length < 1 || parts.length > 4) return null;
  const [top, right = top, bottom = top, left = right] = parts;
  const values: Record<MarginSide, string | undefined> = { top, right, bottom, left };
  return values[side] ?? null;
}

const BORDER_STYLES = new Set([
  'none',
  'hidden',
  'dotted',
  'dashed',
  'solid',
  'double',
  'groove',
  'ridge',
  'inset',
  'outset',
]);
const BORDER_WIDTH_RE = /^(?:-?(?:\d+(?:\.\d+)?|\.\d+)[a-z%]*|thin|medium|thick)$/i;
const ZERO_WIDTH_RE = /^-?0*(?:\.0*)?[a-z%]*$/i;

/**
 * docparser border format `"<width> <style> <color>"` (e.g. `"0.12pt solid #000000"`). Tokens are
 * reordered into width-style-colour order and the colour goes through `normalizeColor`; widths
 * keep their unit. `none`/`hidden` or a zero width means "no border" (attribute absent). Input
 * whose tokens cannot be classified is kept as given.
 */
export function normalizeBorder(value: unknown): string | null {
  const raw = emptyToNull(value)
    ?.replace(/\s*!important\s*$/i, '')
    .trim();
  if (!raw) return null;
  const tokens = raw.match(/(?:rgba?|hsla?|var)\([^)]*\)|\S+/gi) ?? [];
  let width: string | undefined;
  let style: string | undefined;
  let color: string | undefined;
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (BORDER_STYLES.has(lower) && style === undefined) style = lower;
    else if (BORDER_WIDTH_RE.test(token) && width === undefined) width = token;
    else if (color === undefined) color = normalizeColor(token) ?? token;
    else return raw;
  }
  if (style === 'none' || style === 'hidden') return null;
  if (width !== undefined && ZERO_WIDTH_RE.test(width)) return null;
  return [width, style, color].filter(Boolean).join(' ') || null;
}

export type BorderSide = MarginSide;

const SIDE_INDEX: Record<BorderSide, number> = { top: 0, right: 1, bottom: 2, left: 3 };

function cssTokens(value: string): string[] {
  return value.replace(/\s*!important\s*$/i, '').match(/(?:rgba?|hsla?|var)\([^)]*\)|\S+/gi) ?? [];
}

/** Component of a 1–4 value box shorthand (`border-width: 1px 2px`) for `side`. */
function boxComponent(value: string | null, side: BorderSide): string | undefined {
  if (!value) return undefined;
  const parts = cssTokens(value);
  if (parts.length < 1 || parts.length > 4) return undefined;
  const [top, right = top, bottom = top, left = right] = parts;
  return [top, right, bottom, left][SIDE_INDEX[side]];
}

interface BorderParts {
  width?: string;
  style?: string;
  color?: string;
}

function splitBorder(value: string | null): BorderParts {
  const parts: BorderParts = {};
  for (const token of cssTokens(value ?? '')) {
    if (BORDER_STYLES.has(token.toLowerCase()) && parts.style === undefined)
      parts.style = token.toLowerCase();
    else if (BORDER_WIDTH_RE.test(token) && parts.width === undefined) parts.width = token;
    else if (parts.color === undefined) parts.color = token;
  }
  return parts;
}

/**
 * One side's border as docparser `"<w> <style> <color>"`, merged from every inline form a
 * serialiser may produce: `border`, `border-width/-style/-color` (1–4 values), `border-<side>`
 * and `border-<side>-width/-style/-color` (later forms override earlier ones).
 */
function readSideBorder(element: HTMLElement, side: BorderSide): string | null {
  const parts: BorderParts = { ...splitBorder(readStyle(element, 'border')) };
  const merge = (next: BorderParts) => {
    for (const key of ['width', 'style', 'color'] as const)
      if (next[key] !== undefined) parts[key] = next[key];
  };
  merge({
    width: boxComponent(readStyle(element, 'border-width'), side),
    style: boxComponent(readStyle(element, 'border-style'), side)?.toLowerCase(),
    color: boxComponent(readStyle(element, 'border-color'), side),
  });
  merge(splitBorder(readStyle(element, `border-${side}`)));
  merge({
    width: readStyle(element, `border-${side}-width`) ?? undefined,
    style: readStyle(element, `border-${side}-style`)?.toLowerCase() ?? undefined,
    color: readStyle(element, `border-${side}-color`) ?? undefined,
  });
  if (parts.width === undefined && parts.style === undefined && parts.color === undefined)
    return null;
  return normalizeBorder([parts.width, parts.style, parts.color].filter(Boolean).join(' '));
}

/**
 * Border of `side` (see `readSideBorder`). With `side` null (one border for the whole element):
 * the common value when all four sides agree, else the `border` shorthand.
 */
export function readBorder(element: HTMLElement, side: BorderSide | null): string | null {
  if (side) return readSideBorder(element, side);
  const sides = (['top', 'right', 'bottom', 'left'] as const).map((s) =>
    readSideBorder(element, s),
  );
  if (sides.every((v) => v === sides[0])) return sides[0] ?? null;
  return normalizeBorder(readStyle(element, 'border'));
}

/** `background-color`, else a `background` shorthand that is a single colour. */
export function readBackgroundColor(element: HTMLElement): string | null {
  const longhand = readStyle(element, 'background-color');
  if (longhand) return normalizeColor(longhand);
  const shorthand = readStyle(element, 'background')?.trim();
  if (!shorthand || /\s/.test(shorthand.replace(/\([^)]*\)/g, ''))) return null;
  if (/url\(|gradient\(/i.test(shorthand)) return null;
  return normalizeColor(shorthand);
}

/**
 * px integer from `"120"`, `"120px"` or `"90pt"` (1pt = 4/3 px, rounded). Other units and
 * malformed input → null (docparser stores widths/heights as px integers).
 */
export function parsePxInt(raw: string | null | undefined): number | null {
  const m = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*(px|pt)?\s*$/i.exec(raw ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  const px = m[2]?.toLowerCase() === 'pt' ? (n * 4) / 3 : n;
  return Math.round(px);
}
