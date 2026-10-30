import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { diffDocs } from '../src/diagnostics/normalize';

const fixture = (name: string): unknown =>
  (
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL(`../fixtures/docparser/${name}.json`, import.meta.url)),
        'utf8',
      ),
    ) as { doc: unknown }
  ).doc;

/** Lossless JSON of the live editor (playground hook). */
const liveJson = (page: Page) =>
  page.evaluate(() => window.__rcmPlayground?.getLosslessJSON() ?? null);

/** Opens the playground and waits for the editor (the fixture select needs it). */
async function open(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__rcmPlayground);
}

async function load(page: Page, name: string) {
  await open(page);
  await page.getByTestId('fixture-select').selectOption({ label: `docparser/${name}.json` });
  const expected = fixture(name);
  // the JSON view shows the lossless JSON once the fixture is in
  await expect
    .poll(async () => {
      try {
        return diffDocs(
          expected,
          JSON.parse((await page.getByTestId('json-view').textContent()) ?? ''),
        );
      } catch {
        return ['not loaded'];
      }
    })
    .toEqual([]);
  return expected;
}

for (const name of ['synthetic-paragraph', 'synthetic-table-style', 'synthetic-objects']) {
  test(`${name}: lossless in Chromium (JSON and HTML round trip)`, async ({ page }) => {
    const expected = await load(page, name);
    expect(diffDocs(expected, await liveJson(page))).toEqual([]);
    // Chromium's own CSS parsing (margin shorthand, colours, font stacks) on the HTML trip
    const afterHtml = await page.evaluate(() => {
      const hook = window.__rcmPlayground!;
      hook.editor.commands.setContent(hook.editor.getHTML());
      return hook.getLosslessJSON();
    });
    expect(diffDocs(expected, afterHtml)).toEqual([]);
  });
}

test('Tab indents and Shift-Tab restores the JSON', async ({ page }) => {
  const expected = await load(page, 'synthetic-paragraph');
  await page.getByTestId('editor-content').locator('p').first().click();
  await page.keyboard.press('Tab');
  await expect.poll(async () => diffDocs(expected, await liveJson(page)).length).toBeGreaterThan(0);
  await page.keyboard.press('Shift+Tab');
  await expect.poll(async () => diffDocs(expected, await liveJson(page))).toEqual([]);
});

test('an asset: image renders an <img> with a resolved, loaded src', async ({ page }) => {
  await load(page, 'image');
  const img = page.getByTestId('editor-content').locator('img').first();
  await expect(img).toHaveAttribute('src', /^(blob:|https?:|\/)/);
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
  const json = JSON.stringify(await liveJson(page));
  expect(json).toContain('asset:sha256:');
});

test('unknown nodes stay visible and lossless; legacy inline <img> keeps its paragraph', async ({
  page,
}) => {
  await open(page);
  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'keep' }] },
      { type: 'mysteryBlock', attrs: { k: 1 } },
    ],
  };
  const out = await page.evaluate((d) => {
    const hook = window.__rcmPlayground!;
    hook.editor.commands.setContent(d);
    return hook.getLosslessJSON();
  }, doc);
  expect(diffDocs(doc, out)).toEqual([]);
  await expect(
    page.getByTestId('editor-content').locator('[data-unsupported-type="mysteryBlock"]'),
  ).toBeVisible();

  const html = '<p>앞<img src="/favicon.ico" width="16" height="16">뒤</p>';
  const back = await page.evaluate((h) => {
    const hook = window.__rcmPlayground!;
    hook.editor.commands.setContent(h);
    return hook.editor.getHTML();
  }, html);
  expect(back).toBe(html);
});
