// Pure Gotenberg request builders for the PDF example server (no I/O).
// Unit-tested in tests/pdfServer.request.test.ts. Node >= 20, no dependencies.

/** Basename of a relative asset path (`fonts/noto-sans-kr/x.woff2` -> `x.woff2`). */
export function fontBasename(relPath) {
  const cleaned = String(relPath).split('?')[0].split('#')[0];
  const slash = cleaned.lastIndexOf('/');
  return slash === -1 ? cleaned : cleaned.slice(slash + 1);
}

/**
 * Collects the relative `url(...)` references in an `@font-face` CSS string.
 * Absolute URLs (`http:`, `data:`, leading `/`) are left for the caller to ignore:
 * the PDF server only ships repo-local font files.
 */
export function extractFontRefs(fontCssText) {
  const refs = [];
  const pattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
  for (const match of String(fontCssText).matchAll(pattern)) {
    const ref = match[2].trim();
    if (!/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/|data:)/.test(ref)) refs.push(ref);
  }
  return [...new Set(refs)];
}

/**
 * Rewrites relative `url(...)` references to bare filenames. Gotenberg stores every
 * uploaded file in one flat directory, so `fonts/noto-sans-kr/x.woff2` would 404 if
 * sent unchanged — the server uploads each font under its basename instead.
 */
export function rewriteFontCssBasenames(fontCssText) {
  const pattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
  return String(fontCssText).replace(pattern, (whole, quote, ref) => {
    const trimmed = ref.trim();
    if (/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/|data:)/.test(trimmed)) return whole;
    return `url(${quote}${fontBasename(trimmed)}${quote})`;
  });
}

/**
 * Scalar form fields for `/forms/chromium/convert/html`. Page size and margins come
 * from the print HTML's own `@page` rule (`preferCssPageSize`), so no inch/pt/cm unit
 * conversion is needed here.
 */
export function buildFormFields() {
  return { preferCssPageSize: 'true' };
}
