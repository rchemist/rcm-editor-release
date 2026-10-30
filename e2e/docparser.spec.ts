import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const SHA = 'e93186cbb1ded04219e0ed30fa82ae5a501e6256d4717c893c54a9a1ab25a1a7';

/** A ranged response: two ranges of the profile fixture + the PNG asset, as the HTTP body. */
function response(): Buffer {
  const fx = JSON.parse(
    readFileSync(root('fixtures/docparser/profile/synthetic-profile.json'), 'utf8'),
  ) as {
    doc: unknown;
    render_revision: string;
  };
  const png = readFileSync(root(`fixtures/docparser/assets/${SHA}.png`));
  return Buffer.from(
    JSON.stringify({
      render_revision: fx.render_revision,
      docs: [
        { range: {}, doc: fx.doc },
        { range: {}, doc: fx.doc },
      ],
      assets: [
        {
          sha256: SHA,
          media_type: 'image/png',
          width: 16,
          height: 12,
          bytes_b64: png.toString('base64'),
        },
      ],
      warnings: [{ code: 'x', ordinal: null, block_id: null }],
    }),
  );
}

test('open a docparser response: ranges joined by pageBreak, images shown from blob URLs', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__rcmPlayground);
  await page
    .getByTestId('docparser-file')
    .setInputFiles({ name: 'resp.json', mimeType: 'application/json', buffer: response() });
  await expect(page.getByTestId('docparser-info')).toContainText(/tiptap-0\.1\.1\+rcm-editor\.\d+/);
  const editor = page.getByTestId('editor-content');
  // 2 ranges x (2 figures + 1 plain image) and 2 + 1 page breaks
  await expect(editor.locator('img')).toHaveCount(6);
  const srcs = await editor
    .locator('img')
    .evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src));
  expect(srcs.every((s) => s.startsWith('blob:'))).toBe(true);
  await expect
    .poll(() =>
      editor
        .locator('img')
        .evaluateAll((els) => els.every((e) => (e as HTMLImageElement).naturalWidth > 0)),
    )
    .toBe(true);
  await expect(editor.locator('[data-type="page-break"]')).toHaveCount(5);
  // nothing in the JSON view got replaced by the blob URL
  await expect(page.getByTestId('json-view')).toContainText(`asset:sha256:${SHA}`);
  await expect(page.getByTestId('json-view')).not.toContainText('blob:');
});

test('insert a docparser response at the cursor keeps the existing text and undo restores it', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__rcmPlayground);
  const editor = page.getByTestId('editor-content');
  await editor.click();
  await page.keyboard.type('앞뒤');
  await page.keyboard.press('ArrowLeft');
  await page
    .getByTestId('docparser-insert-file')
    .setInputFiles({ name: 'resp.json', mimeType: 'application/json', buffer: response() });
  await expect(editor.locator('img')).toHaveCount(6);
  await expect(editor).toContainText('앞');
  await expect(editor).toContainText('뒤');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(editor.locator('img')).toHaveCount(0);
  await expect(editor).toHaveText('앞뒤');
});
