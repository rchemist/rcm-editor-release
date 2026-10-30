import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Puts the caret at the start of cell `index` (a plain click right after setContent can miss). */
async function caretInCell(page: Page, index: number) {
  await page.evaluate((i) => {
    const editor = window.__rcmPlayground?.editor;
    if (!editor) return;
    const positions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') positions.push(pos);
    });
    editor
      .chain()
      .focus()
      .setTextSelection((positions[i] as number) + 2)
      .run();
  }, index);
}

const tableHtml = (rows: number, cols: number) =>
  `<table><tbody>${Array.from(
    { length: rows },
    (_, r) =>
      `<tr>${Array.from({ length: cols }, (_, c) => `<td><p>${r}${c}</p></td>`).join('')}</tr>`,
  ).join('')}</tbody></table>`;

async function load(page: Page, html: string, query = '') {
  await page.goto(`/${query}`);
  await expect(page.getByTestId('editor-content')).toBeVisible();
  // Focus first: the first click into an unfocused editor does not move ProseMirror's selection.
  await page.getByTestId('editor-content').click();
  await page.evaluate((h) => void window.__rcmPlayground?.editor.commands.setContent(h), html);
}

interface Json {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: Json[];
}
const doc = (page: Page): Promise<Json> =>
  page.evaluate(() => window.__rcmPlayground?.getLosslessJSON() as Json);
const rows = async (page: Page): Promise<Json[]> => {
  const table = (await doc(page)).content?.find((n) => n.type === 'table');
  return table?.content ?? [];
};

async function selectCells(page: Page, from: number, to: number) {
  await page.evaluate(
    ([a, b]) => {
      const editor = window.__rcmPlayground?.editor;
      if (!editor) return;
      const positions: number[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') positions.push(pos);
      });
      editor.commands.setCellSelection({
        anchorCell: positions[a as number] as number,
        headCell: positions[b as number] as number,
      });
    },
    [from, to],
  );
}

test('one click opens the 10x10 grid; picking r x c inserts a table without header', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('rcm-tb-table').click();
  const cells = page.getByTestId('rcm-tbo-table-cell');
  await expect(cells).toHaveCount(100);
  await expect(page.locator('.rcm-tb-panel')).toHaveCount(1);
  await page.locator('[data-testid="rcm-tbo-table-cell"][data-row="3"][data-col="4"]').click();
  const r = await rows(page);
  expect(r).toHaveLength(3);
  for (const row of r) {
    expect(row.content).toHaveLength(4);
    expect(row.content?.every((c) => c.type === 'tableCell')).toBe(true);
  }
  await expect(page.getByTestId('editor-content')).toBeFocused();
});

test('table grid: arrows move, Enter inserts, Esc closes into the editor', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('editor-content').click();
  await page.keyboard.press('Shift+Tab');
  for (let i = 0; i < 60; i++) {
    if ((await page.locator('[data-rcm-ctl]:focus').getAttribute('data-testid')) === 'rcm-tb-table')
      break;
    await page.keyboard.press('ArrowRight');
  }
  await page.keyboard.press('Enter');
  const focus = page.locator('[data-testid="rcm-tbo-table-cell"]:focus');
  await expect(focus).toHaveAttribute('data-row', '1');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(focus).toHaveAttribute('data-row', '2');
  await expect(focus).toHaveAttribute('data-col', '3');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('rcm-tbo-table-cell')).toHaveCount(0);
  await expect(page.getByTestId('editor-content')).toBeFocused();
  expect(await rows(page)).toHaveLength(0);

  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const r = await rows(page);
  expect(r).toHaveLength(2);
  expect(r[0]?.content).toHaveLength(2);
});

test('right click in a cell opens the menu and actions change the JSON (also without toolbar)', async ({
  page,
}) => {
  await load(page, tableHtml(2, 2), '?toolbar=none');
  await page.locator('td').first().click({ button: 'right' });
  const menu = page.getByTestId('rcm-table-menu');
  await expect(menu).toHaveAttribute('role', 'menu');
  await page.getByTestId('rcm-tm-addRowAfter').click();
  await expect(menu).toHaveCount(0);
  expect(await rows(page)).toHaveLength(3);

  await page.locator('td').first().click({ button: 'right' });
  await page.getByTestId('rcm-tm-addColumnAfter').click();
  expect((await rows(page))[0]?.content).toHaveLength(3);

  await page.locator('td').first().click({ button: 'right' });
  await page.getByTestId('rcm-tm-toggleHeaderRow').click();
  expect((await rows(page))[0]?.content?.[0]?.type).toBe('tableHeader');

  await page.locator('td').first().click({ button: 'right' });
  await page.getByTestId('rcm-tm-deleteRow').click();
  expect(await rows(page)).toHaveLength(2);

  await page.locator('td').first().click({ button: 'right' });
  await page.getByTestId('rcm-tm-deleteColumn').click();
  expect((await rows(page))[0]?.content).toHaveLength(2);

  // merge / split need a cell selection
  await page.locator('td').first().click({ button: 'right' });
  await expect(page.getByTestId('rcm-tm-mergeCells')).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  await selectCells(page, 2, 3);
  await page.locator('td').first().click({ button: 'right' });
  await expect(page.getByTestId('rcm-tm-mergeCells')).not.toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('rcm-tm-mergeCells').click();
  expect(((await rows(page))[1]?.content?.[0]?.attrs ?? {}).colspan).toBe(2);
  await page.locator('td').first().click({ button: 'right' });
  await page.getByTestId('rcm-tm-splitCell').click();
  expect(((await rows(page))[1]?.content?.[0]?.attrs ?? {}).colspan).toBe(1);

  await page.locator('td').first().click({ button: 'right' });
  await page.getByTestId('rcm-tm-cellBackground').click();
  await page.locator('[data-testid^="rcm-tm-cellBackground-"][data-value]').nth(6).click();
  expect(((await rows(page))[1]?.content?.[0]?.attrs ?? {}).backgroundColor).toMatch(
    /^#[0-9a-f]{6}$/,
  );

  await page.locator('td').first().click({ button: 'right' });
  await page.getByTestId('rcm-tm-deleteTable').click();
  expect(await rows(page)).toHaveLength(0);
});

test('outside a table the browser menu stays; tableMenu=0 disables the cell menu', async ({
  page,
}) => {
  await load(page, `<p>plain</p>${tableHtml(1, 1)}`);
  await page.evaluate(() => {
    const w = window as unknown as { __prevented?: boolean };
    document.addEventListener('contextmenu', (e) => (w.__prevented = e.defaultPrevented));
  });
  await page.locator('.ProseMirror > p').first().click({ button: 'right' });
  expect(
    await page.evaluate(() => (window as unknown as { __prevented?: boolean }).__prevented),
  ).toBe(false);
  await expect(page.getByTestId('rcm-table-menu')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await load(page, tableHtml(1, 1), '?tableMenu=0');
  await page.locator('td').first().click({ button: 'right' });
  await expect(page.getByTestId('rcm-table-menu')).toHaveCount(0);
});

test('cell menu by keyboard: Shift+F10, arrows, Esc returns focus to the editor', async ({
  page,
}) => {
  await load(page, tableHtml(2, 2));
  await page.locator('td').nth(1).click();
  await page.keyboard.press('Shift+F10');
  const menu = page.getByTestId('rcm-table-menu');
  await expect(menu).toBeVisible();
  const items = menu.locator('[role="menuitem"]');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(items.last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId('editor-content')).toBeFocused();

  // Enter runs the focused action
  await page.keyboard.press('ContextMenu');
  await expect(menu).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  expect(await rows(page)).toHaveLength(3);
  await expect(page.getByTestId('editor-content')).toBeFocused();
});

test('dragging a column border stores an integer px colwidth', async ({ page }) => {
  await load(page, tableHtml(2, 2));
  const box = await page.locator('td').first().boundingBox();
  if (!box) throw new Error('no cell');
  const y = box.y + box.height / 2;
  const edge = box.x + box.width - 2;
  await page.mouse.move(edge, y);
  await expect(page.locator('.column-resize-handle').first()).toBeAttached();
  await page.mouse.down();
  await page.mouse.move(edge + 30, y, { steps: 5 });
  await page.mouse.move(edge + 60, y, { steps: 5 });
  await page.mouse.up();
  const widths = ((await rows(page))[0]?.content ?? []).map((c) => c.attrs?.colwidth);
  const first = widths[0] as number[] | null;
  expect(Array.isArray(first)).toBe(true);
  expect(first?.length).toBe(1);
  expect(Number.isInteger(first?.[0])).toBe(true);
  expect(first?.[0]).toBeGreaterThan(box.width);
});

test('Tab / Shift-Tab move between cells; Tab in the last cell adds a row', async ({ page }) => {
  await load(page, tableHtml(2, 2));
  const cell = (n: number) => page.locator('td').nth(n);
  const inCell = (n: number) =>
    page.evaluate((i) => {
      const editor = window.__rcmPlayground?.editor;
      if (!editor) return false;
      const node = editor.view.domAtPos(editor.state.selection.from).node;
      const el = node instanceof Element ? node : node.parentElement;
      return el?.closest('td') === document.querySelectorAll('td')[i];
    }, n);
  await caretInCell(page, 0);
  await page.keyboard.press('Tab');
  expect(await inCell(1)).toBe(true);
  await page.keyboard.press('Tab');
  expect(await inCell(2)).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await inCell(1)).toBe(true);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  expect(await inCell(3)).toBe(true);
  expect(await rows(page)).toHaveLength(2);
  await page.keyboard.press('Tab');
  expect(await rows(page)).toHaveLength(3);
  expect(await inCell(4)).toBe(true);
});

test('a 2x2 cell selection is visibly different from unselected cells', async ({ page }) => {
  await load(page, tableHtml(3, 3));
  await selectCells(page, 0, 4);
  const selected = page.locator('td.selectedCell');
  await expect(selected).toHaveCount(4);
  const style = (sel: string) =>
    page
      .locator(sel)
      .first()
      .evaluate((el) => {
        const s = getComputedStyle(el);
        const after = getComputedStyle(el, '::after');
        return {
          bg: s.backgroundColor,
          outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`,
          overlay: after.backgroundColor,
        };
      });
  const on = await style('td.selectedCell');
  const off = await style('td:not(.selectedCell)');
  expect(on.bg !== off.bg || on.outline !== off.outline).toBe(true);
  expect(on.overlay).not.toBe(off.overlay);
  // the token drives it and has a dark value
  await page.emulateMedia({ colorScheme: 'light' });
  const light = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--rcm-editor-cell-selected'),
  );
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  const dark = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--rcm-editor-cell-selected'),
  );
  expect(light.trim()).not.toBe('');
  expect(dark.trim()).not.toBe(light.trim());
});
