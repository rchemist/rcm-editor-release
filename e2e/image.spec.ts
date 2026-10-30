import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// 1x1 transparent PNG; width/height attributes give it real layout size offline.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG = `data:image/png;base64,${PNG_B64}`;

interface Json {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: Json[];
}

async function load(page: Page, html: string, query = '') {
  await page.goto(`/${query}`);
  await expect(page.getByTestId('editor-content')).toBeVisible();
  await page.getByTestId('editor-content').click();
  await page.evaluate((h) => void window.__rcmPlayground?.editor.commands.setContent(h), html);
}

const doc = (page: Page): Promise<Json> =>
  page.evaluate(() => window.__rcmPlayground?.getLosslessJSON() as Json);

function images(json: Json): Json[] {
  const out: Json[] = [];
  const walk = (n: Json | undefined) => {
    if (!n) return;
    if (n.type === 'image' || n.type === 'inlineImage') out.push(n);
    n.content?.forEach(walk);
  };
  walk(json);
  return out;
}

const blockDoc = (w: number, h: number, extra = '') =>
  `<p>before</p><img src="${PNG}" width="${w}" height="${h}"${extra}><p>after</p>`;

async function selectImage(page: Page) {
  await page.locator('.ProseMirror img').first().click();
  await expect(page.getByTestId('rcm-image-bar')).toBeVisible();
}

test('corner drag keeps the ratio within 1px, writes integer px, one undo step', async ({
  page,
}) => {
  // The demo fixture is the editor's initial content, so it is not an undoable edit of its
  // own: the drag commit below is the only history entry and one undo restores the size.
  await page.goto('/?image=demo');
  await expect(page.getByTestId('editor-content')).toBeVisible();
  // The node view wraps the image; the block image is the first top-level container.
  await page.locator('.ProseMirror > [data-resize-container] img').first().click();
  await expect(page.getByTestId('rcm-image-bar')).toBeVisible();
  await expect(page.getByTestId('rcm-image-handle')).toHaveCount(4);

  const before = await doc(page);
  const handle = page.locator('[data-testid="rcm-image-handle"][data-corner="se"]');
  const box = await handle.boundingBox();
  if (!box) throw new Error('no handle box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  // Drag (+80, +60): width-driven with a locked 16:9 ratio.
  await page.mouse.move(cx + 80, cy + 60, { steps: 5 });
  // No document change mid-drag.
  expect(await doc(page)).toEqual(before);
  await page.mouse.move(cx + 80, cy + 60, { steps: 5 });
  await page.mouse.up();

  // The demo doc holds three images; the resized block image is picked by its alt text.
  const block = async () => images(await doc(page)).find((n) => n.attrs?.alt === '블록 이미지');
  const resized = await block();
  expect(resized?.attrs?.width).toBe(400);
  expect(resized?.attrs?.height).toBe(225);
  expect(Number.isInteger(resized?.attrs?.width)).toBe(true);
  expect(Number.isInteger(resized?.attrs?.height)).toBe(true);
  // |400 - 225 * (320/180)| = 0 <= 1: the starting ratio is kept.
  expect(
    Math.abs((resized?.attrs?.width as number) - (resized?.attrs?.height as number) * (320 / 180)),
  ).toBeLessThanOrEqual(1);

  // A single undo step restores the original size, redo brings the resize back.
  await page.evaluate(() => void window.__rcmPlayground?.editor.commands.undo());
  expect((await block())?.attrs).toMatchObject({ width: 320, height: 180 });
  await page.evaluate(() => void window.__rcmPlayground?.editor.commands.redo());
  expect((await block())?.attrs).toMatchObject({ width: 400, height: 225 });
});

test('align buttons set the attribute and the DOM placement', async ({ page }) => {
  await load(page, blockDoc(320, 180));
  await selectImage(page);
  for (const value of ['left', 'center', 'right', 'inline'] as const) {
    await page.getByTestId(`rcm-ib-align-${value}`).click();
    await expect(page.getByTestId(`rcm-ib-align-${value}`)).toHaveAttribute('aria-pressed', 'true');
    const [img] = images(await doc(page));
    expect(img?.attrs?.align).toBe(value);
    await expect(page.locator(`.ProseMirror [data-align="${value}"]`).first()).toBeAttached();
  }
});

test('alt text edit writes attrs.alt; Esc cancels and returns focus', async ({ page }) => {
  await load(page, blockDoc(320, 180, ' alt="old"'));
  await selectImage(page);
  await page.getByTestId('rcm-ib-alt').click();
  const input = page.getByTestId('rcm-ibo-alt-input');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('old');
  await input.fill('새 설명');
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  const [img] = images(await doc(page));
  expect(img?.attrs?.alt).toBe('새 설명');
  await expect(page.getByTestId('editor-content')).toBeFocused();

  await page.getByTestId('rcm-ib-alt').click();
  const reopened = page.getByTestId('rcm-ibo-alt-input');
  await expect(reopened).toHaveValue('새 설명');
  await reopened.fill('취소됨');
  await reopened.press('Escape');
  const [kept] = images(await doc(page));
  expect(kept?.attrs?.alt).toBe('새 설명');
  await expect(page.getByTestId('editor-content')).toBeFocused();
});

test('Esc on the image bar returns focus to the editor', async ({ page }) => {
  await load(page, blockDoc(320, 180));
  await selectImage(page);
  await page.getByTestId('rcm-ib-align-left').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('editor-content')).toBeFocused();
});

test('demo fixture: figure caption state and inline image bar', async ({ page }) => {
  await page.goto('/?image=demo');
  await expect(page.getByTestId('editor-content')).toBeVisible();

  // The figure image selects with the caption pressed.
  await page.locator('figure img').click();
  await expect(page.getByTestId('rcm-image-bar')).toBeVisible();
  await expect(page.getByTestId('rcm-ib-caption')).toHaveAttribute('aria-pressed', 'true');

  // The inline image shows left/right/inline only and no caption.
  await page.locator('.ProseMirror p img').first().click();
  await expect(page.getByTestId('rcm-image-bar')).toBeVisible();
  await expect(page.getByTestId('rcm-ib-align-left')).toBeVisible();
  await expect(page.getByTestId('rcm-ib-align-right')).toBeVisible();
  await expect(page.getByTestId('rcm-ib-align-inline')).toBeVisible();
  await expect(page.getByTestId('rcm-ib-align-center')).toHaveCount(0);
  await expect(page.getByTestId('rcm-ib-caption')).toHaveCount(0);
});
