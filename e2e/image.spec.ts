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

/** Loads `html` outside the undo history, so the first undo reverts the test's own edit. */
async function loadUndoable(page: Page, html: string) {
  await page.goto('/');
  await expect(page.getByTestId('editor-content')).toBeVisible();
  await page.evaluate(
    (h) =>
      void window.__rcmPlayground?.editor
        .chain()
        .setMeta('addToHistory', false)
        .setContent(h)
        .run(),
    html,
  );
}

const figureDoc = `<p>before</p><figure><img src="${PNG}" width="40" height="30"><figcaption>cap</figcaption></figure><p>after</p>`;

/** Node types and image srcs of the top-level blocks (src null = an image filled in by the schema). */
const outline = (json: Json): string[] =>
  (json.content ?? []).map((n) =>
    n.type === 'figure'
      ? `figure(${images(n)
          .map((i) => (i.attrs?.src ? 'img' : 'EMPTY'))
          .join(',')})`
      : n.type === 'image'
        ? n.attrs?.src
          ? 'img'
          : 'EMPTY'
        : `${n.type}:${(n.content ?? []).map((c) => (c as { text?: string }).text ?? c.type).join('')}`,
  );

for (const [name, act, expected] of [
  [
    'typing',
    (p: Page) => p.keyboard.type('ab'),
    ['paragraph:before', 'paragraph:ab', 'paragraph:after'],
  ],
  [
    'Backspace',
    (p: Page) => p.keyboard.press('Backspace'),
    ['paragraph:before', 'paragraph:after'],
  ],
  ['Delete', (p: Page) => p.keyboard.press('Delete'), ['paragraph:before', 'paragraph:after']],
] as const) {
  test(`figure image selected + ${name} replaces the whole figure, never an empty image; undo restores it`, async ({
    page,
  }) => {
    await loadUndoable(page, figureDoc);
    await page.locator('figure img').click();
    await expect(page.getByTestId('rcm-image-bar')).toBeVisible();
    await act(page);
    expect(outline(await doc(page))).toEqual(expected);
    await page.keyboard.press('ControlOrMeta+z');
    expect(outline(await doc(page))).toEqual([
      'paragraph:before',
      'figure(img)',
      'paragraph:after',
    ]);
  });
}

// Chromium commits an IME composition over a node selection into the textblock before it; the
// figure must come out of it whole (no empty image).
test('figure image selected + Korean IME composition keeps the figure whole', async ({ page }) => {
  await load(page, figureDoc);
  await page.locator('figure img').click();
  await expect(page.getByTestId('rcm-image-bar')).toBeVisible();
  const session = await page.context().newCDPSession(page);
  for (const text of ['ㅎ', '하', '한'])
    await session.send('Input.imeSetComposition', { text, selectionStart: 1, selectionEnd: 1 });
  await session.send('Input.insertText', { text: '한' });
  await expect.poll(async () => outline(await doc(page)).join('|')).toContain('한');
  const blocks = outline(await doc(page));
  expect(blocks.filter((b) => b.includes('EMPTY'))).toEqual([]);
  expect(blocks).toContain('figure(img)');
});

test('plain image selected + typing replaces it with the text (no empty image)', async ({
  page,
}) => {
  await load(page, blockDoc(40, 30));
  await selectImage(page);
  await page.keyboard.type('ab');
  expect(outline(await doc(page))).toEqual(['paragraph:before', 'paragraph:ab', 'paragraph:after']);
});
