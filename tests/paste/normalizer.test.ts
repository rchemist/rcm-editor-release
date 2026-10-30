import { describe, expect, it } from 'vitest';
import {
  classifyHwpClipboardProvenance,
  isHwpClipboardHtml,
  isWordClipboardHtml,
  normalizePastedHtml,
} from '../../src/paste/normalize';
import { createEditorExtensions } from '../../src/schema/kit';
import { Editor } from '@tiptap/core';

const schemaOf = () => new Editor({ extensions: createEditorExtensions() }).schema;

const WORD_HTML = [
  '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">',
  '<head>',
  '<meta name="Generator" content="Microsoft Word 15">',
  '<!--[if gte mso 9]><xml><o:OfficeDocumentSettings/></xml><![endif]-->',
  '<style><!-- p.MsoNormal { mso-style-name: "보통"; } --></style>',
  '</head>',
  '<body>',
  '<p class="MsoNormal" style="margin: 0cm; mso-pagination: none;">',
  '<span lang="KO" style="mso-fareast-font-family: 굴림;">Hello<o:p></o:p></span>',
  '</p>',
  '<p class="MsoListParagraphCxSpFirst" style="mso-list: l0 level1 lfo1;">',
  '<span style="mso-list: ignore;">1.<span>&nbsp;&nbsp;</span></span>first',
  '</p>',
  '<p class="MsoListParagraphCxSpLast" style="mso-list: l0 level1 lfo1;">',
  '<span style="mso-list: ignore;">2.<span>&nbsp;&nbsp;</span></span>second',
  '</p>',
  '</body></html>',
].join('');

const HWP_HTML =
  '<html><head><meta name="generator" content="Hancom Office Hanword 2022"></head>' +
  '<body><p>한글 <b>굵게</b></p></body></html>';

describe('HWP/Word provenance classification', () => {
  it('detects Word clipboard HTML by mso markers', () => {
    expect(isWordClipboardHtml(WORD_HTML)).toBe(true);
    expect(isWordClipboardHtml('<p>Hello</p>')).toBe(false);
  });

  it('detects HWP clipboard HTML by generator meta', () => {
    expect(isHwpClipboardHtml(HWP_HTML)).toBe(true);
    expect(isHwpClipboardHtml('<p>Hello</p>')).toBe(false);
  });

  it('classifies hancom namespace markers (hwpx vs hwp)', () => {
    expect(
      classifyHwpClipboardProvenance(
        '<p xmlns:hp="https://hancom.co.kr/hwpml/2011/paragraph">x</p>',
      ),
    ).toBe('hwpx');
    expect(classifyHwpClipboardProvenance('<p xmlns:hwp="https://hancom.co.kr/hwp">x</p>')).toBe(
      'hwp',
    );
  });

  it('fails closed on conflicting HWP/HWPX markers', () => {
    expect(
      classifyHwpClipboardProvenance(
        '<p xmlns:hp="https://hancom.co.kr/hwpml/2011/paragraph" data-hwp-format="hwp">x</p>',
      ),
    ).toBe(null);
  });
});

describe('Word junk removal and list reconstruction', () => {
  it('removes comments, o:p, xml, meta and Office style blocks', () => {
    const { html, dropped } = normalizePastedHtml(WORD_HTML, { schema: schemaOf() });
    expect(html).not.toContain('o:p');
    expect(html).not.toContain('MsoNormal');
    expect(html).not.toContain('mso-');
    expect(html).not.toContain('<!--');
    expect(html).not.toContain('<meta');
    expect(html).not.toContain('<style');
    expect(html).toContain('Hello');
    expect(dropped.some((entry) => entry.tag === 'style')).toBe(true);
  });

  it('reconstructs Word numbered paragraphs into a semantic list', () => {
    const { html } = normalizePastedHtml(WORD_HTML, { schema: schemaOf() });
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>first</li>');
    expect(html).toContain('<li>second</li>');
    expect(html).not.toContain('mso-list');
  });

  it('keeps ambiguous Word list paragraphs as paragraphs', () => {
    const ambiguous =
      '<p class="MsoListParagraphCxSpFirst" style="mso-list: l0 level1 lfo1;">' +
      '<span style="mso-list: ignore;">1.</span>one</p>' +
      '<p class="MsoListParagraphCxSpLast" style="mso-list: l0 level3 lfo1;">' +
      '<span style="mso-list: ignore;">2.</span>jump</p>';
    const { html } = normalizePastedHtml(ambiguous, { schema: schemaOf() });
    expect(html).not.toContain('<ol>');
    expect(html).toContain('one');
    expect(html).toContain('jump');
  });
});

describe('hostile markup and unknown elements', () => {
  it('drops script and style with content and reports them', () => {
    const { html, dropped } = normalizePastedHtml(
      '<p>keep</p><script>alert(1)</script><style>p{color:red}</style>',
      { schema: schemaOf() },
    );
    expect(html).toContain('keep');
    expect(html).not.toContain('script');
    expect(html).not.toContain('alert');
    expect(html).not.toContain('<style');
    expect(dropped.map((entry) => entry.tag).sort()).toEqual(['script', 'style']);
  });

  it('strips javascript: hrefs, leaving event handlers for the policy', () => {
    const { html } = normalizePastedHtml(
      '<p onclick="evil()">a</p><a href="javascript:alert(1)">b</a>' +
        '<a href="https://example.test/x">c</a>',
      { schema: schemaOf() },
    );
    // Event handlers stay in the normalizer output: the policy plugin removes and reports
    // them (`policyRemoved`), so the pasted result still has none (see paste.test.ts).
    expect(html).toContain('onclick');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('https://example.test/x');
  });

  it('unwraps unknown wrappers keeping children', () => {
    const { html, dropped } = normalizePastedHtml(
      '<div class="custom"><section><p>deep</p></section></div>',
      { schema: schemaOf() },
    );
    expect(html).toContain('<p>deep</p>');
    expect(html).not.toContain('custom');
    expect(dropped).toEqual([]);
  });

  it('keeps embeds as rawHtml placeholders instead of dropping them', () => {
    const { html, dropped } = normalizePastedHtml(
      '<p>a</p><iframe src="https://www.youtube.com/embed/abc"></iframe>',
      { schema: schemaOf() },
    );
    expect(html).toContain('data-rcm-raw-html');
    expect(html).toContain('youtube.com');
    expect(dropped).toEqual([]);
  });
});

describe('web paste style retention', () => {
  it('keeps schema-consumed declarations and values as written', () => {
    const { html } = normalizePastedHtml(
      '<p style="line-height: 1.6; text-indent: 10pt; margin-top: 6pt; ' +
        'text-align: center; mso-foo: bar;">' +
        '<span style="font-family: &quot;함초롬돋움&quot;, serif; font-size: 14px; ' +
        'color: #C00000; letter-spacing: 0.1em;">x</span></p>',
      { schema: schemaOf() },
    );
    for (const kept of [
      'line-height: 1.6',
      'text-indent: 10pt',
      'margin-top: 6pt',
      'text-align: center',
      'font-size: 14px',
      'color: #C00000',
      'letter-spacing: 0.1em',
    ]) {
      expect(html).toContain(kept);
    }
    expect(html).not.toContain('mso-foo');
    expect(html).toContain('함초롬돋움');
  });

  it('carries block text styles down to spans', () => {
    const { html } = normalizePastedHtml('<p style="color: #c00000;">hi</p>', {
      schema: schemaOf(),
    });
    expect(html).toContain('<span');
    expect(html).toContain('color: #c00000');
  });

  it('keeps cell background on the cell, not as a text highlight', () => {
    const { html } = normalizePastedHtml(
      '<table><tbody><tr><td style="background-color: #ffff00;">x</td></tr></tbody></table>',
      { schema: schemaOf() },
    );
    expect(html).toContain('background-color: #ffff00');
    expect(html).not.toContain('<mark');
  });

  it('keeps table, image and link attributes the schema consumes', () => {
    const { html } = normalizePastedHtml(
      '<table width="100%" data-align="center"><tbody><tr>' +
        '<td colspan="2" rowspan="1" style="border-top: 1pt solid #000000; ' +
        'vertical-align: top;">x</td></tr></tbody></table>' +
        '<img src="https://example.test/i.png" alt="alt" width="200" height="100">' +
        '<a href="https://example.test/" target="_blank" rel="noopener">l</a>',
      { schema: schemaOf() },
    );
    for (const kept of [
      'colspan="2"',
      'border-top: 1pt solid #000000',
      'vertical-align: top',
      'src="https://example.test/i.png"',
      'alt="alt"',
      'width="200"',
      'target="_blank"',
    ]) {
      expect(html).toContain(kept);
    }
  });
});
