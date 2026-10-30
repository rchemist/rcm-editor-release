import { expect, test } from '@playwright/test';

// Same sentinel as STYLES_MISSING_CODE in src/react/styleCheck.ts.
const STYLES_MISSING_CODE = 'RCM_EDITOR_STYLES_MISSING';

test('consumer app renders, hydrates and runs consumer extensions', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.text().includes(STYLES_MISSING_CODE)) {
      problems.push(`${m.type()}: ${m.text()} @ ${m.location().url}`);
    }
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

  await page.goto('/');

  const bare = page.getByTestId('bare').locator('[data-rcm-editor] [contenteditable="true"]');
  await expect(bare).toBeVisible();
  await bare.click();
  await page.keyboard.type('bare ok');
  await expect(bare).toContainText('bare ok');

  const ext = page.getByTestId('consumer-editor');
  await expect(ext).toHaveAttribute('contenteditable', 'true');
  await expect(ext).toHaveAttribute('data-consumer-pm-plugin', 'active');
  await ext.click();
  await page.keyboard.type('hello');
  await expect(page.getByTestId('consumer-json')).toContainText('hello');
  await expect(ext).not.toHaveAttribute('data-consumer-pm-tx', '0');

  await page.getByTestId('consumer-highlight').click();
  await expect(page.getByTestId('consumer-json')).toContainText('"type":"highlight"');
  await expect(ext.locator('mark')).toHaveText('hello');

  const token = await page
    .locator('[data-rcm-editor]')
    .first()
    .evaluate((el) => getComputedStyle(el).getPropertyValue('--rcm-editor-styles-loaded').trim());
  expect(token).not.toBe('');

  expect(problems).toEqual([]);
});
