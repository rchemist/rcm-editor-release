import { afterEach, describe, expect, it } from 'vitest';
import { destroyEditors, makeEditor } from '../helpers/editor';
import { mountEditor } from '../../src/vanilla';
import { getContentReport, getLosslessHTML } from '../../src/index';
import type { ContentReport } from '../../src/index';

afterEach(destroyEditors);

const BLOCKS = [
  '<div class="custom" style="color: red">styled</div>',
  '<section><p>nested</p></section>',
  '<table cellpadding="5"><tbody><tr><td>c</td></tr></tbody></table>',
  '<iframe src="https://www.youtube.com/embed/abc123"></iframe>',
];

describe('schema-outside blocks', () => {
  it('custom divs, sections, off-schema tables and allowed iframes become rawHtml and round-trip byte-identical', () => {
    const input = `<p>keep</p>${BLOCKS.join('')}`;
    const reports: ContentReport[] = [];
    const editor = makeEditor(input, { onContentReport: (r) => reports.push(r) });
    expect(editor.getJSON().content?.map((n) => n.type)).toEqual([
      'paragraph',
      'rawHtml',
      'rawHtml',
      'rawHtml',
      'rawHtml',
    ]);
    // cellpadding has no schema attribute: the table stays verbatim instead of dropping it.
    expect(reports[0]!.rawHtml.map((entry) => entry.path)).toEqual([
      '[1](div)',
      '[2](section)',
      '[3](table)',
      '[4](iframe)',
    ]);
    expect(reports[0]!.unknownHtml).toEqual([]);
    const html = editor.getHTML();
    for (const block of BLOCKS) expect(html).toContain(block);
    expect(html).not.toContain('data-rcm-raw-html');
    expect(getLosslessHTML(editor)).toBe(input);
  });
});

describe('verbatim getHTML', () => {
  it('editor and vanilla getHTML render rawHtml verbatim, never escaped or placeholder', () => {
    const input = '<div class="a">x</div><p>y</p>';
    const editor = makeEditor(input);
    const html = editor.getHTML();
    expect(html).toContain('<div class="a">x</div>');
    expect(html).not.toContain('data-rcm-raw-html');
    expect(html).not.toContain('&lt;div');

    const host = document.createElement('div');
    document.body.appendChild(host);
    try {
      const mounted = mountEditor(host, { defaultValue: input });
      try {
        expect(mounted.getHTML()).toContain('<div class="a">x</div>');
      } finally {
        mounted.destroy();
      }
    } finally {
      host.remove();
    }
  });
});

describe('unedited preservation', () => {
  it('unedited loads are byte-identical; edits keep raw fragments verbatim; undo restores the string', () => {
    const input = '<p>plain</p><div class="k" style="color: red">raw</div>';
    const editor = makeEditor(input);
    expect(getLosslessHTML(editor)).toBe(input);

    editor.commands.insertContentAt(1, 'X');
    const edited = getLosslessHTML(editor);
    expect(edited).toContain('<div class="k" style="color: red">raw</div>');
    expect(edited).toContain('Xplain');

    editor.commands.undo();
    expect(getLosslessHTML(editor)).toBe(input);
  });
});

describe('trusted preview', () => {
  it('the trusted preview is a sandboxed srcdoc iframe without same-origin access', () => {
    const input = '<p>t</p><script>window.__t37b = 1;</script>';
    const host = document.createElement('div');
    document.body.appendChild(host);
    try {
      const mounted = mountEditor(host, { defaultValue: input, htmlPolicy: 'trusted' });
      try {
        const frames = [...mounted.editor.view.dom.querySelectorAll('iframe')];
        const preview = frames.find((frame) =>
          (frame.getAttribute('srcdoc') ?? '').includes('window.__t37b'),
        );
        expect(preview).toBeDefined();
        expect(preview!.getAttribute('sandbox')).toBe('allow-scripts');
        expect(preview!.getAttribute('sandbox')).not.toContain('allow-same-origin');
      } finally {
        mounted.destroy();
      }
    } finally {
      host.remove();
    }
    expect(
      getContentReport(makeEditor(input, { htmlPolicy: 'trusted' }))?.rawHtml.length,
    ).toBeGreaterThan(0);
  });
});

describe('no over-preservation', () => {
  const types = (html: string) =>
    makeEditor(html)
      .getJSON()
      .content?.map((n) => n.type);

  it('pretty-printed blocks (indentation and newlines only) open editable', () => {
    const input =
      '<h2>\n  Title\n</h2>\n<ul>\n  <li>\n    <p>A</p>\n  </li>\n</ul>\n' +
      '<table>\n  <tbody>\n    <tr>\n      <td>x</td>\n    </tr>\n  </tbody>\n</table>';
    const editor = makeEditor(input);
    expect(editor.getJSON().content?.map((n) => n.type)).toEqual([
      'heading',
      'bulletList',
      'table',
    ]);
    expect(getContentReport(editor)?.rawHtml ?? []).toEqual([]);
    // Unedited output stays the loaded source, byte for byte.
    expect(getLosslessHTML(editor)).toBe(input);
  });

  it('attributes at the schema default (colspan/rowspan 1) and duplicated values open editable', () => {
    const input =
      '<table><tbody><tr><td colspan="1" rowspan="1" data-background-color="#ffeeaa" ' +
      'style="background-color: rgb(255, 238, 170);"><p>a</p></td></tr></tbody></table>';
    expect(types(input)).toEqual(['table']);
  });

  it('real loss still keeps the block verbatim', () => {
    // Inner text whitespace is content, not formatting.
    expect(types('<p>a  <span class="x">b</span></p>')).toEqual(['rawHtml']);
    // Unknown attribute the schema ignores.
    expect(types('<table cellpadding="5"><tbody><tr><td>c</td></tr></tbody></table>')).toEqual([
      'rawHtml',
    ]);
    // A non-default value of an attribute the schema reads is kept by the schema, not dropped.
    expect(types('<table><tbody><tr><td colspan="2">c</td></tr></tbody></table>')).toEqual([
      'table',
    ]);
  });

  it('the rawHtml preview shows table guide lines only while editable', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    try {
      const mounted = mountEditor(host, {
        defaultValue: '<table border="0"><tbody><tr><td>c</td></tr></tbody></table>',
      });
      try {
        const srcdoc = () =>
          mounted.editor.view.dom.querySelector('iframe')?.getAttribute('srcdoc') ?? '';
        expect(srcdoc()).toContain('outline:1px dashed');
        // Silent toggle (no `update` event), the way the content guard and `readonly` do it.
        mounted.editor.setEditable(false, false);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(srcdoc()).toContain('border="0"');
        expect(srcdoc()).not.toContain('outline:1px dashed');
        expect(mounted.editor.getHTML()).not.toContain('outline');
      } finally {
        mounted.destroy();
      }
    } finally {
      host.remove();
    }
  });
});
