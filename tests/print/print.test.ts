import { afterEach, describe, expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { destroyEditors, makeEditor } from '../helpers/editor';
import { printCss, renderPrintHtml } from '../../src/print/index';

afterEach(destroyEditors);

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures/docparser');

function loadDoc(name: string): JSONContent {
  return (JSON.parse(readFileSync(join(fixtureDir, name), 'utf8')) as { doc: JSONContent }).doc;
}

function bodyInner(html: string): string {
  const found = new DOMParser()
    .parseFromString(html, 'text/html')
    .querySelector('.rcm-editor .ProseMirror');
  expect(found, 'print body keeps the editor content root').not.toBeNull();
  return found!.innerHTML;
}

const norm = (css: string): string => css.replace(/\s+/g, '');

describe('print HTML renderer', () => {
  it('A4: @page size+margin, no script/link/import, doctype+charset', () => {
    const { html } = renderPrintHtml(
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] },
      { page: 'A4' },
    );
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<meta charset="utf-8">');
    expect(norm(html)).toContain(norm('@page'));
    expect(norm(html)).toContain('size:A4');
    expect(norm(html)).toContain('margin:20mm');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<link');
    expect(html).not.toContain('@import');
    expect(html).not.toContain('@font-face');
  });

  it('Letter/custom page sizes, object margins, fontCss only via @font-face', () => {
    const fontCss = "@font-face{font-family:'X';src:url(x.woff2);}";
    const letter = renderPrintHtml({ type: 'doc' }, { page: 'Letter' });
    expect(norm(letter.html)).toContain('size:Letter');
    const custom = renderPrintHtml(
      { type: 'doc' },
      {
        page: { width: '100mm', height: '200mm' },
        margins: { top: '1mm', right: '2mm', bottom: '3mm', left: '4mm' },
        fontCss,
      },
    );
    expect(norm(custom.html)).toContain(norm('size: 100mm 200mm'));
    expect(norm(custom.html)).toContain(norm('margin: 1mm 2mm 3mm 4mm'));
    expect(custom.html).toContain(fontCss);
    expect(custom.html).not.toContain('<script');
    expect(custom.html).not.toContain('<link');
    expect(custom.html).not.toContain('@import');
    const single = renderPrintHtml({ type: 'doc' }, { margins: '10mm' });
    expect(norm(single.html)).toContain('margin:10mm');
  });

  it('trusted raw script prints without it and reports script', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'rawHtml',
          attrs: { html: '<div class="kept">ok</div><script>alert("x")</script>' },
        },
      ],
    };
    const { html, report } = renderPrintHtml(doc, { htmlPolicy: 'trusted' });
    expect(html).not.toContain('<script');
    expect(bodyInner(html)).toContain('<div class="kept">ok</div>');
    expect(report.policyRemoved.some((entry) => entry.kind === 'script')).toBe(true);
  });

  it('trusted and function policies still print no handlers or javascript: URLs', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'rawHtml',
          attrs: {
            html: '<img src="x" onerror="alert(1)"><a href="javascript:alert(2)">a</a><p>kept</p>',
          },
        },
      ],
    };
    for (const htmlPolicy of ['trusted', (html: string) => html] as const) {
      const { html, report } = renderPrintHtml(doc, { htmlPolicy });
      expect(html).not.toContain('onerror');
      expect(html).not.toContain('javascript:');
      expect(bodyInner(html)).toContain('kept');
      expect(report.policyRemoved.length).toBeGreaterThan(0);
    }
  });

  it('sanitize raw script is policy-cleaned and reported', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'rawHtml',
          attrs: { html: '<div class="kept">ok</div><script>alert("x")</script>' },
        },
      ],
    };
    const { html, report } = renderPrintHtml(doc);
    expect(html).not.toContain('<script');
    expect(bodyInner(html)).toContain('<div class="kept">ok</div>');
    expect(report.policyRemoved.some((entry) => entry.kind === 'script')).toBe(true);
  });

  it('pageBreak renders a break-after page element', () => {
    const { html } = renderPrintHtml({ type: 'doc', content: [{ type: 'pageBreak' }] });
    expect(norm(bodyInner(html))).toContain('break-after:page');
  });

  it.each(['synthetic-paragraph.json', 'synthetic-table-style.json', 'image.json'])(
    'body %s equals the editor getHTML() inside the root wrapper',
    (name) => {
      const doc = loadDoc(name);
      const editor = makeEditor(doc);
      const expected = editor.getHTML();
      expect(expected.length).toBeGreaterThan(0);
      const { html, report } = renderPrintHtml(doc);
      expect(report.policyRemoved).toEqual([]);
      // Print-only change: a leading all-`th` row moves into `thead` (header repeats per page).
      const unhoisted = bodyInner(html).replace(/<thead>(.*?)<\/thead><tbody>/g, '<tbody>$1');
      expect(unhoisted).toBe(expected);
    },
  );

  it('a leading header row prints in thead; body rows stay in tbody', () => {
    const cell = (type: string, text: string): JSONContent => ({
      type,
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    });
    const { html } = renderPrintHtml({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [cell('tableHeader', 'H1'), cell('tableHeader', 'H2')] },
            { type: 'tableRow', content: [cell('tableCell', 'a'), cell('tableCell', 'b')] },
          ],
        },
      ],
    });
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const table = parsed.querySelector('table');
    expect(table?.tHead?.rows).toHaveLength(1);
    expect(table?.tBodies[0]?.rows).toHaveLength(1);
  });

  it('fontCss family leads the font tokens and the margin boxes', () => {
    const fontCss = "@font-face { font-family: 'Noto Sans KR'; src: url(a.woff2); }";
    const css = norm(printCss({ fontCss, footer: '{page}' }));
    expect(css).toContain("--rcm-editor-font-family:'NotoSansKR',");
    expect(css).toMatch(/@bottom-center\{font-family:'NotoSansKR',sans-serif;?\}/);
  });

  it('rawHtml payload prints verbatim under the default policy', () => {
    const payload = '<div class="keep-me" data-x="1">raw <b>bold</b></div>';
    const { html } = renderPrintHtml({
      type: 'doc',
      content: [{ type: 'rawHtml', attrs: { html: payload } }],
    });
    expect(bodyInner(html)).toContain(payload);
  });

  it('header/footer text escaped, page counters mapped', () => {
    const { html } = renderPrintHtml(
      { type: 'doc', content: [{ type: 'paragraph' }] },
      { header: 'A&B <b> "q" </style><script>', footer: 'p {page} / {pages}' },
    );
    const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    expect(style).toContain('\\"q\\"');
    expect(style).toContain('\\3C ');
    expect(style).toContain('counter(page)');
    expect(style).toContain('counter(pages)');
    expect(html).not.toContain('{page}');
    expect(html).not.toContain('<script');
    // The header never becomes body markup.
    expect(bodyInner(html)).not.toContain('<b>');
  });

  it('title escaped, lang default and override', () => {
    const ko = renderPrintHtml({ type: 'doc' }, { title: '<T>&"' });
    expect(ko.html).toContain('<html lang="ko">');
    expect(ko.html).toContain('<title>&lt;T&gt;&amp;&quot;</title>');
    const en = renderPrintHtml({ type: 'doc' }, { lang: 'en' });
    expect(en.html).toContain('<html lang="en">');
  });

  it('unknown nodes print as nothing instead of throwing', () => {
    const { html } = renderPrintHtml({
      type: 'doc',
      content: [
        { type: 'noSuchNode', content: [{ type: 'text', text: 'gone' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'kept', marks: [{ type: 'noSuchMark' }] },
            { type: 'text', text: 'here' },
          ],
        },
      ],
    } as unknown as JSONContent);
    const body = bodyInner(html);
    expect(body).toContain('kept');
    expect(body).toContain('here');
    expect(body).not.toContain('gone');
  });

  it('printCss() alone carries page rules and no external refs', () => {
    const css = printCss({ page: 'A4', header: 'h', footer: 'f {page}' });
    expect(norm(css)).toContain('size:A4');
    expect(css).not.toContain('<script');
    expect(css).not.toContain('<link');
    expect(css).not.toContain('@import');
  });
});

describe('print security fixes', () => {
  const bodyChildren = (html: string): Element[] => [
    ...new DOMParser().parseFromString(html, 'text/html').body.children,
  ];

  it('page and margins cannot close <style> (invalid values fall back)', () => {
    const evil = 'A4;}</style><img src=x onerror=alert(1)><style>';
    for (const options of [
      { page: evil as 'A4' },
      { page: { width: '1px;}</style><img src=x onerror=alert(1)>', height: '1px' } },
      {
        margins: '0;}</style><meta http-equiv=refresh content="0;url=file:///etc/hostname"><style>',
      },
    ]) {
      const { html } = renderPrintHtml({ type: 'doc' }, options);
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      expect(parsed.querySelectorAll('style')).toHaveLength(1);
      expect(parsed.querySelector('[onerror], meta[http-equiv]')).toBeNull();
    }
    expect(norm(printCss({ page: { width: '210mm', height: '297mm' }, margins: '1in' }))).toContain(
      'size:210mm297mm;margin:1in',
    );
  });

  it('fontCss and its family name cannot close <style>', () => {
    const fontCss =
      "@font-face{font-family:'x</style><img src=x onerror=alert(1)>';src:url(a.woff2)}";
    const { html } = renderPrintHtml({ type: 'doc' }, { fontCss });
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    expect(parsed.querySelectorAll('style')).toHaveLength(1);
    expect(parsed.querySelector('[onerror]')).toBeNull();
  });

  it('stray end tags in a raw payload stay inside the body wrapper', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [{ type: 'rawHtml', attrs: { html: '</div></div></body><p>outside</p><div>' } }],
    };
    for (const htmlPolicy of ['sanitize', 'trusted'] as const) {
      const children = bodyChildren(renderPrintHtml(doc, { htmlPolicy }).html);
      expect(children).toHaveLength(1);
      expect(children[0]?.className).toBe('rcm-editor');
    }
  });

  it('image src with a script scheme is removed and reported', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [{ type: 'image', attrs: { src: ' JaVa\tScript:alert(1)' } }],
    };
    const { html, report } = renderPrintHtml(doc);
    expect(html.toLowerCase()).not.toMatch(/java\s*script:/);
    expect(report.policyRemoved.some((entry) => entry.kind === 'javascript-url')).toBe(true);
  });
});
