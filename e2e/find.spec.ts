import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type FindWindow = Window & { __rcmModFPrevented?: boolean };

/**
 * Records, at the window (the last bubble stop), whether Mod-F was prevented by the page.
 * The modifier itself arrives as a separate keydown first (macOS Meta), so no `once` listener.
 */
async function armModFRecorder(page: Page) {
  await page.evaluate(() => {
    const w = window as FindWindow;
    w.__rcmModFPrevented = undefined;
    window.addEventListener('keydown', (event) => {
      const key = event.key.toLowerCase();
      if (key === 'f' && (event.metaKey || event.ctrlKey) && !event.altKey) {
        w.__rcmModFPrevented = event.defaultPrevented;
      }
    });
  });
}

test('Mod-F inside the editor opens the panel with the input focused', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('editor-content').click();
  await armModFRecorder(page);
  await page.keyboard.press('ControlOrMeta+F');
  await expect(page.getByTestId('rcm-find-panel')).toBeVisible();
  await expect(page.getByTestId('rcm-find-panel')).toHaveAttribute('role', 'search');
  await expect(page.getByTestId('rcm-find-input')).toBeFocused();
  expect(await page.evaluate(() => (window as FindWindow).__rcmModFPrevented)).toBe(true);
});

test('findShortcut=false leaves Mod-F to the browser (defaultPrevented=false)', async ({
  page,
}) => {
  await page.goto('/?findShortcut=0');
  await page.getByTestId('editor-content').click();
  await armModFRecorder(page);
  await page.keyboard.press('ControlOrMeta+F');
  expect(await page.evaluate(() => (window as FindWindow).__rcmModFPrevented)).toBe(false);
  await expect(page.getByTestId('rcm-find-panel')).toHaveCount(0);
});

test('Mod-F outside the editor stays the browser default', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('theme-toggle').focus();
  await armModFRecorder(page);
  await page.keyboard.press('ControlOrMeta+F');
  expect(await page.evaluate(() => (window as FindWindow).__rcmModFPrevented)).toBe(false);
  await expect(page.getByTestId('rcm-find-panel')).toHaveCount(0);
});

test('the toolbar find button opens the panel', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('rcm-tb-find').click();
  await expect(page.getByTestId('rcm-find-panel')).toBeVisible();
  await expect(page.getByTestId('rcm-find-input')).toBeFocused();
});

test('keyboard flow: count, Enter/Shift+Enter, case toggle, Esc refocuses the editor', async ({
  page,
}) => {
  await page.goto('/');
  const area = page.getByTestId('editor-content');
  await area.click();
  await page.keyboard.type('one two one two');
  await page.keyboard.press('ControlOrMeta+F');
  await expect(page.getByTestId('rcm-find-input')).toBeFocused();
  await page.keyboard.type('two');
  const count = page.getByTestId('rcm-find-count');
  await expect(count).toHaveAttribute('data-total', '2');
  await expect(count).toHaveAttribute('data-current', '1');
  await expect(page.locator('.find-and-replace-result')).toHaveCount(2);
  // Enter / Shift+Enter walk the results while the focus is in the find input.
  await page.keyboard.press('Enter');
  await expect(count).toHaveAttribute('data-current', '2');
  await page.keyboard.press('Shift+Enter');
  await expect(count).toHaveAttribute('data-current', '1');
  // The case toggle changes the count ("one" is lower case in the document).
  await page.getByTestId('rcm-find-input').fill('ONE');
  await expect(count).toHaveAttribute('data-total', '2');
  await page.getByTestId('rcm-find-case').click();
  await expect(page.getByTestId('rcm-find-case')).toHaveAttribute('aria-pressed', 'true');
  await expect(count).toHaveAttribute('data-total', '0');
  await expect(count).toHaveAttribute('data-current', '0');
  await page.getByTestId('rcm-find-case').click();
  await expect(count).toHaveAttribute('data-total', '2');
  // Esc closes the panel from any control; the focus returns to the editing area.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('rcm-find-panel')).toHaveCount(0);
  await expect(area).toBeFocused();
  await expect(page.locator('.find-and-replace-result')).toHaveCount(0);
});

test('replace-all updates the document JSON', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('editor-content').click();
  await page.keyboard.type('cat dog cat');
  await page.keyboard.press('ControlOrMeta+F');
  await page.keyboard.type('cat');
  await page.getByTestId('rcm-replace-input').fill('dog');
  await page.getByTestId('rcm-find-replace-all').click();
  const json = await page.evaluate(() => JSON.stringify(window.__rcmPlayground?.getLosslessJSON()));
  expect(json).toContain('dog dog dog');
  expect(json).not.toContain('cat');
});
