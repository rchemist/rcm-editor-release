import { describe, expect, it } from 'vitest';
import {
  buildFormFields,
  extractFontRefs,
  fontBasename,
  rewriteFontCssBasenames,
} from '../examples/pdf-server/buildRequest.mjs';
import { fontCss } from '../src/print/fontCss';

describe('pdf-server request builder', () => {
  it('builder: repo fontCss refs become flat basenames for the multipart', () => {
    const css = fontCss();
    expect(extractFontRefs(css)).toEqual([
      'fonts/noto-sans-kr/NotoSansKR-Variable.woff2',
      'fonts/noto-serif-kr/NotoSerifKR-Variable.woff2',
    ]);
    const rewritten = rewriteFontCssBasenames(css);
    expect(rewritten).toContain('url(NotoSansKR-Variable.woff2)');
    expect(rewritten).toContain('url(NotoSerifKR-Variable.woff2)');
    expect(rewritten).not.toContain('fonts/');
  });

  it('builder: absolute and data URLs pass through untouched', () => {
    const css =
      '@font-face { src: url(https://cdn.example/a.woff2); }\n' +
      '@font-face { src: url(data:font/woff2;base64,AAA); }\n' +
      '@font-face { src: url(fonts/x/y.woff2); }';
    expect(extractFontRefs(css)).toEqual(['fonts/x/y.woff2']);
    const rewritten = rewriteFontCssBasenames(css);
    expect(rewritten).toContain('url(https://cdn.example/a.woff2)');
    expect(rewritten).toContain('url(data:font/woff2;base64,AAA)');
    expect(rewritten).toContain('url(y.woff2)');
  });

  it('builder: fontBasename strips directories and query strings', () => {
    expect(fontBasename('fonts/noto-sans-kr/NotoSansKR-Variable.woff2')).toBe(
      'NotoSansKR-Variable.woff2',
    );
    expect(fontBasename('plain.woff2?v=2')).toBe('plain.woff2');
  });

  it('builder: page size comes from CSS, not converted form fields', () => {
    expect(buildFormFields()).toEqual({ preferCssPageSize: 'true' });
  });
});
