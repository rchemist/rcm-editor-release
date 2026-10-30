// `@font-face` rules for the repo's bundled OFL fonts (`fonts/`): one variable WOFF2 per
// family, weight range = the file's real `wght` axis, so Chromium renders true 700. Pass the
// output to `renderPrintHtml({ fontCss })` / `printCss({ fontCss })`.

/** Bundled families: `fonts/<dir>/` — allowlisted by `scripts/check-fonts.mjs`. */
export type FontCssFamily = 'sans' | 'serif';

const FAMILIES: Record<FontCssFamily, { css: string; file: string; weight: string }> = {
  sans: {
    css: 'Noto Sans KR',
    file: 'fonts/noto-sans-kr/NotoSansKR-Variable.woff2',
    weight: '100 900',
  },
  serif: {
    css: 'Noto Serif KR',
    file: 'fonts/noto-serif-kr/NotoSerifKR-Variable.woff2',
    weight: '200 900',
  },
};

export interface FontCssOptions {
  /**
   * Prefix concatenated before each file path (plain string join — end it with `/` if it is a
   * directory). Default `''`: the relative path inside `fonts/`, which the PDF server (* Gotenberg) resolves against the files sent in the same multipart request.
   */
  baseUrl?: string;
  /** Default: both families, sans first. */
  families?: FontCssFamily[];
}

/**
 * `@font-face` CSS for the bundled Noto KR fonts — `font-display: swap`, WOFF2 only, no
 * `@import`, no absolute URL by default. The files are NOT in the npm package: consumers host
 * `fonts/` themselves and point `baseUrl` at it.
 */
export function fontCss(options: FontCssOptions = {}): string {
  const { baseUrl = '', families = ['sans', 'serif'] as FontCssFamily[] } = options;
  return families
    .map((key) => {
      const family = FAMILIES[key];
      return (
        `@font-face {\n` +
        `  font-family: '${family.css}';\n` +
        `  font-style: normal;\n` +
        `  font-weight: ${family.weight};\n` +
        `  font-display: swap;\n` +
        `  src: url(${baseUrl}${family.file}) format('woff2');\n` +
        `}`
      );
    })
    .join('\n');
}
