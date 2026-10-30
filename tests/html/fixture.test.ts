import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { destroyEditors, makeEditor } from '../helpers/editor';
import { getContentReport, getLosslessHTML } from '../../src/index';

afterEach(destroyEditors);

const FIXTURE = join(__dirname, '..', '..', 'fixtures', 'html', 'admission-synthetic.html');

describe('admission-style fixture', () => {
  it('every style, script, meta, link and iframe tag survives a trusted load verbatim', () => {
    const source = readFileSync(FIXTURE, 'utf8');
    const editor = makeEditor(source, { htmlPolicy: 'trusted' });
    expect(getLosslessHTML(editor)).toBe(source);

    const parsed = new DOMParser().parseFromString(source, 'text/html');
    const html = editor.getHTML();
    for (const tag of ['style', 'script', 'meta', 'link', 'iframe']) {
      const elements = [...parsed.querySelectorAll(tag)];
      expect(elements.length, `${tag} present in the fixture`).toBeGreaterThan(0);
      for (const el of elements) expect(html, tag).toContain(el.outerHTML);
    }
    expect(getContentReport(editor)?.policyRemoved).toEqual([]);
  });
});
