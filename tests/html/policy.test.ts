import { afterEach, describe, expect, it } from 'vitest';
import { destroyEditors, makeEditor } from '../helpers/editor';
import { applyHtmlPolicy, getContentReport, getLosslessHTML } from '../../src/index';
import type { ContentReport } from '../../src/index';

afterEach(destroyEditors);

const DIRTY = [
  '<p>keep</p>',
  '<script>evil()</script>',
  '<p><a href="javascript:alert(1)" onclick="steal()">x</a></p>',
  '<p><a href="  JaVaScRiPt:alert(2)">y</a></p>',
  '<iframe src="https://evil.example/v"></iframe>',
  '<img src="x" onerror="boom()">',
].join('');

describe('sanitize policy', () => {
  it('removes scripts, event handlers, javascript: URLs and off-host iframes with a report', () => {
    const reports: ContentReport[] = [];
    const editor = makeEditor(DIRTY, { onContentReport: (r) => reports.push(r) });
    const lossless = getLosslessHTML(editor);
    expect(lossless).toContain('<p>keep</p>');
    expect(lossless).not.toContain('<script');
    expect(lossless).not.toContain('onclick');
    expect(lossless).not.toContain('onerror');
    expect(lossless).not.toContain('javascript:');
    expect(lossless).not.toContain('evil.example');
    // The image itself survives; only its handler is gone.
    expect(lossless).toContain('<img src="x">');
    const kinds = reports[0]!.policyRemoved.map((entry) => entry.kind);
    for (const kind of ['script', 'event-handler', 'javascript-url', 'iframe-host'] as const)
      expect(kinds).toContain(kind);
  });

  it('keeps style, class, id, data-*, meta and link verbatim', () => {
    const input =
      '<link rel="stylesheet" href="https://a.example/b.css">' +
      '<meta name="viewport" content="width=1">' +
      '<div class="c" id="i" data-x="1" style="color: red">t</div>' +
      '<style>.c{color:red}</style>';
    const editor = makeEditor(input, { htmlPolicy: 'sanitize' });
    const lossless = getLosslessHTML(editor);
    for (const piece of [
      '<link rel="stylesheet" href="https://a.example/b.css">',
      '<meta name="viewport" content="width=1">',
      'class="c"',
      'id="i"',
      'data-x="1"',
      'style="color: red"',
      '<style>.c{color:red}</style>',
    ])
      expect(lossless).toContain(piece);
    expect(getContentReport(editor)?.policyRemoved).toEqual([]);
  });

  it('keeps listed https iframe hosts and drops the rest', () => {
    const reports: ContentReport[] = [];
    const editor = makeEditor(
      '<iframe src="https://www.youtube.com/embed/abc"></iframe>' +
        '<iframe src="http://www.youtube.com/embed/abc"></iframe>',
      { onContentReport: (r) => reports.push(r) },
    );
    const lossless = getLosslessHTML(editor);
    expect(lossless).toContain('https://www.youtube.com/embed/abc');
    expect(lossless).not.toContain('http://www.youtube.com/embed/abc');
    expect(reports[0]!.policyRemoved.map((entry) => entry.kind)).toEqual(['iframe-host']);
  });

  it('iframeHosts extends the allowlist', () => {
    const input = '<iframe src="https://player.example.edu/v/1"></iframe>';
    expect(getLosslessHTML(makeEditor(input))).not.toContain('player.example.edu');
    const allowed = makeEditor(input, { iframeHosts: ['player.example.edu'] });
    expect(getLosslessHTML(allowed)).toContain('https://player.example.edu/v/1');
  });
});

describe('trusted policy', () => {
  it('keeps scripts in the stored value', () => {
    const input = '<p>t</p><script>window.__t37a = 1;</script>';
    const editor = makeEditor(input, { htmlPolicy: 'trusted' });
    expect(getLosslessHTML(editor)).toBe(input);
    expect(getContentReport(editor)?.policyRemoved).toEqual([]);
  });
});

describe('function policy', () => {
  it('the function result is the stored value', () => {
    const seen: string[] = [];
    const editor = makeEditor('<p>orig</p>', {
      htmlPolicy: (html, ctx) => {
        seen.push(`${ctx.source}:${html}`);
        return '<p>replaced</p>';
      },
    });
    expect(getLosslessHTML(editor)).toBe('<p>replaced</p>');
    expect(editor.getText()).toContain('replaced');
    expect(seen).toEqual(['initial:<p>orig</p>']);
  });
});

describe('meta refresh with padded http-equiv', () => {
  it('a space-padded http-equiv refresh is removed and reported', () => {
    const result = applyHtmlPolicy(
      '<meta http-equiv=" Refresh " content="0;url=https://example.com"><p>a</p>',
      { source: 'setContent' },
    );
    expect(result.html).not.toContain('http-equiv');
    expect(result.removed.some((entry) => entry.detail.includes('refresh'))).toBe(true);
  });
});
