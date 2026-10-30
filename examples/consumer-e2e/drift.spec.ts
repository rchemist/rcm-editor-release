import { expect, test } from '@playwright/test';

// Same sentinel as TIPTAP_DUPLICATE_CODE in src/tiptapVersion.ts.
const TIPTAP_DUPLICATE_CODE = 'RCM_EDITOR_TIPTAP_DUPLICATE';
// Set by scripts/consumer-smoke.sh: 1 for the drifted install, 0 after `overrides`.
const expected = Number(process.env.CONSUMER_EXPECT_DUPLICATE_WARNINGS ?? '0');

test('tiptap version drift: duplicate warning count matches the install', async ({ page }) => {
  const duplicates: string[] = [];
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.text().includes(TIPTAP_DUPLICATE_CODE)) duplicates.push(`${m.type()}: ${m.text()}`);
    else if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto('/');
  await expect(page.locator('[data-rcm-editor]')).toBeVisible();
  const editable = page.getByTestId('consumer-editor');

  if (expected === 0) {
    await expect(editable).toHaveAttribute('contenteditable', 'true');
    await editable.click();
    await page.keyboard.type('aligned');
    await expect(editable).toContainText('aligned');
    expect(errors).toEqual([]);
    expect(duplicates).toEqual([]);
    return;
  }

  await expect.poll(() => duplicates.length).toBeGreaterThan(0);
  // Observe what tiptap does with the mixed install (reported, not asserted).
  let editing = 'editor not created';
  try {
    await expect(editable).toHaveAttribute('contenteditable', 'true', { timeout: 5000 });
    await editable.click();
    await page.keyboard.type('drift');
    await expect(editable).toContainText('drift', { timeout: 2000 });
    editing = 'typing works';
  } catch {
    if (editing === 'editor not created' && (await editable.count())) editing = 'typing failed';
  }
  console.log(`[drift] editing=${editing} errors=${JSON.stringify(errors.slice(0, 3))}`);
  console.log(`[drift] warning=${duplicates[0]}`);
  expect(duplicates).toHaveLength(expected);
  expect(duplicates[0]).toMatch(/^warning: /);
});
