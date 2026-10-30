import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { preserveHtmlForLoad } from '../../src/html/preserve';
import { scanUnknownHtml } from '../../src/guard/guard';
import { getContentReport } from '../../src/index';
import { destroyEditors, makeEditor } from '../helpers/editor';

afterEach(destroyEditors);

const fixtures = join(__dirname, '..', '..', 'fixtures');

/** HTML inputs: the synthetic legacy page plus both large docparser documents as editor HTML. */
function inputs(): { name: string; html: string }[] {
  const out = [
    {
      name: 'admission-synthetic',
      html: readFileSync(join(fixtures, 'html', 'admission-synthetic.html'), 'utf8'),
    },
  ];
  for (const path of [['large.json'], ['profile', 'large.json']]) {
    const { doc } = JSON.parse(readFileSync(join(fixtures, 'docparser-large', ...path), 'utf8'));
    out.push({ name: path.join('/'), html: makeEditor(doc).getHTML() });
  }
  return out;
}

// ~600-block inputs: same CPU-bound HTML load budget as `roundtripGate.test.ts` on CI.
const budget = (name: string): number | undefined => (name.includes('large') ? 20_000 : undefined);

describe('load-path deduplication (output-equivalence guard)', () => {
  for (const entry of inputs()) {
    it(
      `${entry.name}: skipped scan equals the slow-path scan`,
      () => {
        const editor = makeEditor(entry.html);
        const preserved = preserveHtmlForLoad(entry.html, editor.schema, {
          source: 'setContent',
        });
        expect(getContentReport(editor)?.unknownHtml).toEqual(
          scanUnknownHtml(preserved.html, editor.schema),
        );
      },
      budget(entry.name),
    );

    it(
      `${entry.name}: insert path reports match the slow-path scan`,
      () => {
        const editor = makeEditor('<p>anchor</p>');
        editor.commands.insertContent(entry.html);
        const report = getContentReport(editor);
        expect(report?.format).toBe('html');
        const preserved = preserveHtmlForLoad(entry.html, editor.schema, {
          source: 'insertContent',
        });
        expect(report?.unknownHtml).toEqual(scanUnknownHtml(preserved.html, editor.schema));
        expect(report?.rawHtml).toEqual(preserved.rawHtml);
      },
      budget(entry.name),
    );
  }
});
