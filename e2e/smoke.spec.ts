import { expect, test } from '@playwright/test';

test('typing updates JSON and HTML views', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-content');
  await editor.click();
  await page.keyboard.type('hello');
  await expect(page.getByTestId('json-view')).toContainText('hello');
  await expect(page.getByTestId('html-view')).toContainText('<p>');
});

test('theme toggle sets data-theme on html', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('minHeight prop sets the editing area height', async ({ page }) => {
  await page.goto('/');
  const box = await page.getByTestId('editor-content').boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(240);
});

test('editing area is a labelled multiline textbox', async ({ page }) => {
  await page.goto('/');
  const area = page.getByTestId('editor-content');
  await expect(area).toHaveAttribute('role', 'textbox');
  await expect(area).toHaveAttribute('aria-multiline', 'true');
  await expect(area).toHaveAttribute('aria-label', /.+/);
  await expect(page.getByRole('textbox', { name: /.+/ }).first()).toBeVisible();
});
