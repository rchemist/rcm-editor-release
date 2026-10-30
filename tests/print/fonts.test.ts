import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fontCss, renderPrintHtml } from '../../src/print/index';
import { fontStack } from '../../src/index';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

type FontCase = { name: string; family: string; stack: string };
const fontMap = JSON.parse(
  readFileSync(join(root, 'fixtures/fonts/docparser-font-map.json'), 'utf8'),
) as Record<'serif' | 'sans' | 'family' | 'fallback', FontCase[]>;

describe('fontStack(): docparser fonts.go port', () => {
  it('fixture holds the full docparser mapping table', () => {
    expect(fontMap.serif.length).toBe(7);
    expect(fontMap.sans.length).toBe(10);
    expect(fontMap.serif.map((c) => c.name).concat(fontMap.sans.map((c) => c.name))).toContain(
      '함초롬바탕',
    );
    expect(fontMap.serif.map((c) => c.name).concat(fontMap.sans.map((c) => c.name))).toContain(
      '함초롬돋움',
    );
  });

  it.each(fontMap.serif.map((c) => [c.name, c] as const))(
    'serif name %s keeps the name and lands on Noto Serif KR',
    (_name, c) => {
      expect(fontStack(c.name, c.family)).toBe(c.stack);
    },
  );

  it.each(fontMap.sans.map((c) => [c.name, c] as const))(
    'sans name %s keeps the name and lands on Noto Sans KR',
    (_name, c) => {
      expect(fontStack(c.name, c.family)).toBe(c.stack);
    },
  );

  it.each(fontMap.family.map((c) => [c.name, c.family, c] as const))(
    'MYUNGJO/명조 family %s of %s picks the generic by family type',
    (_name, _family, c) => {
      expect(fontStack(c.name, c.family)).toBe(c.stack);
    },
  );

  it.each(fontMap.fallback.map((c) => [c.name, c] as const))(
    'unknown name %s falls back to sans-serif with quoting/escaping',
    (_name, c) => {
      expect(fontStack(c.name, c.family)).toBe(c.stack);
    },
  );

  it('omitting family matches the empty-family Go behaviour', () => {
    expect(fontStack('바탕')).toBe(fontStack('바탕', ''));
    expect(fontStack('custom')).toBe('"custom", sans-serif');
  });
});

describe('fontCss(): bundled OFL @font-face rules', () => {
  it('two families, variable weight ranges, swap, relative woff2 url', () => {
    const css = fontCss();
    expect(css.match(/@font-face \{/g)).toHaveLength(2);
    expect(css).toContain("font-family: 'Noto Sans KR';");
    expect(css).toContain("font-family: 'Noto Serif KR';");
    expect(css).toContain('font-weight: 100 900;');
    expect(css).toContain('font-weight: 200 900;');
    expect(css.match(/font-display: swap;/g)).toHaveLength(2);
    expect(css).toContain("url(fonts/noto-sans-kr/NotoSansKR-Variable.woff2) format('woff2')");
    expect(css).toContain("url(fonts/noto-serif-kr/NotoSerifKR-Variable.woff2) format('woff2')");
    expect(css).not.toContain('@import');
    expect(css).not.toMatch(/https?:\/\//);
  });

  it('baseUrl prefixes the file path, families selects a subset', () => {
    const prefixed = fontCss({ baseUrl: '/assets/fonts-root/' });
    expect(prefixed).toContain(
      'url(/assets/fonts-root/fonts/noto-sans-kr/NotoSansKR-Variable.woff2)',
    );
    expect(prefixed).not.toContain('url(fonts/');
    const serifOnly = fontCss({ families: ['serif'] });
    expect(serifOnly.match(/@font-face \{/g)).toHaveLength(1);
    expect(serifOnly).toContain("font-family: 'Noto Serif KR';");
    expect(serifOnly).not.toContain('Noto Sans KR');
  });

  it('renderPrintHtml embeds fontCss() output verbatim, still no external ref', () => {
    const { html } = renderPrintHtml(
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '한글' }] }] },
      { fontCss: fontCss() },
    );
    expect(html).toContain('@font-face');
    expect(html).toContain("url(fonts/noto-sans-kr/NotoSansKR-Variable.woff2) format('woff2')");
    expect(html).not.toContain('@import');
    expect(html).not.toMatch(/https?:\/\//);
  });
});

describe('check-fonts licensing gate', () => {
  const runScript = (args: string[]) =>
    spawnSync(process.execPath, [join(root, 'scripts/check-fonts.mjs'), ...args], {
      cwd: root,
      encoding: 'utf8',
    });

  it('self-test passes (ok fixture ok, commercial/stray fixtures rejected)', () => {
    const run = runScript(['--self-test']);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('self-test: ok fixture passes');
  });

  it('the real fonts/ holds only allowlisted OFL families and files', () => {
    const run = runScript([]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('noto-sans-kr, noto-serif-kr');
  });
});
