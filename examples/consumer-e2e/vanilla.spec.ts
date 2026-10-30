import { expect, test } from '@playwright/test';

// framework-free consumer (examples/consumer-vanilla): mountEditor lifecycle driven
// only through the DOM — typing, readonly lock, destroy/remount without leaked roots.
// Same sentinel as STYLES_MISSING_CODE in src/react/styleCheck.ts.
const STYLES_MISSING_CODE = 'RCM_EDITOR_STYLES_MISSING';

type Problems = string[];

function watch(page: import('@playwright/test').Page): Problems {
  const problems: Problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.text().includes(STYLES_MISSING_CODE)) {
      problems.push(`${m.type()}: ${m.text()} @ ${m.location().url}`);
    }
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

test('vanilla mount: typing appears in vanilla-html with no console errors', async ({ page }) => {
  const problems = watch(page);

  await page.goto('/');
  const editable = page.getByTestId('vanilla-editor');
  await expect(editable).toHaveAttribute('contenteditable', 'true');
  await editable.click();
  await page.keyboard.type('vanilla ok');
  await expect(page.getByTestId('vanilla-html')).toContainText('vanilla ok');

  expect(problems).toEqual([]);
});

test('vanilla readonly toggle: typing is blocked, then works again', async ({ page }) => {
  const problems = watch(page);

  await page.goto('/');
  const editable = page.getByTestId('vanilla-editor');
  await editable.click();
  await page.keyboard.type('locked?');
  await expect(page.getByTestId('vanilla-html')).toContainText('locked?');

  await page.getByTestId('vanilla-readonly').click();
  await expect(page.locator('#editor [contenteditable="true"]')).toHaveCount(0);
  await editable.click();
  await page.keyboard.type('nope');
  await expect(page.getByTestId('vanilla-html')).toContainText('locked?');
  await expect(page.getByTestId('vanilla-html')).not.toContainText('nope');

  await page.getByTestId('vanilla-readonly').click();
  await expect(editable).toHaveAttribute('contenteditable', 'true');
  await editable.click();
  await page.keyboard.type(' again');
  await expect(page.getByTestId('vanilla-html')).toContainText('again');

  expect(problems).toEqual([]);
});

test('vanilla destroy/remount: element emptied, remount edits, 5 cycles leave one root', async ({
  page,
}) => {
  const problems = watch(page);

  await page.goto('/');
  const editable = page.getByTestId('vanilla-editor');
  await expect(editable).toHaveAttribute('contenteditable', 'true');

  await page.getByTestId('vanilla-destroy').click();
  expect(await page.locator('#editor').evaluate((el) => el.childElementCount)).toBe(0);
  await expect(page.locator('[data-rcm-editor]')).toHaveCount(0);

  await page.getByTestId('vanilla-remount').click();
  await expect(editable).toHaveAttribute('contenteditable', 'true');
  await editable.click();
  await page.keyboard.type('remounted');
  await expect(page.getByTestId('vanilla-html')).toContainText('remounted');

  for (let cycle = 0; cycle < 5; cycle++) {
    await page.getByTestId('vanilla-destroy').click();
    await expect(page.locator('[data-rcm-editor]')).toHaveCount(0);
    await page.getByTestId('vanilla-remount').click();
    await expect(page.locator('[data-rcm-editor]')).toHaveCount(1);
  }
  await expect(page.locator('[data-rcm-editor]')).toHaveCount(1);
  await editable.click();
  await page.keyboard.type('final');
  await expect(page.getByTestId('vanilla-html')).toContainText('final');

  expect(problems).toEqual([]);
});
