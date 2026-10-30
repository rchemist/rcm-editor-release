import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { DEFAULT_EDITOR_LABELS } from '../src/react/labels';
import { TOOLBAR_PRESETS } from '../src/react/toolbar/items';

const presetIds = (preset: 'simple' | 'full') =>
  TOOLBAR_PRESETS[preset].filter((e) => e !== '|').map((k) => `rcm-tb-${k as string}`);

const tbIds = (page: Page): Promise<string[]> =>
  page
    .locator('[data-testid^="rcm-tb-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid') as string));

const docJson = (page: Page): Promise<string> =>
  page.evaluate(() => JSON.stringify(window.__rcmPlayground?.getLosslessJSON()));

const focusedId = (page: Page): Promise<string | null> =>
  page.locator('[data-rcm-ctl]:focus').getAttribute('data-testid');

async function typeAndSelect(page: Page, text = 'hello') {
  await page.getByTestId('editor-content').click();
  await page.keyboard.type(text);
  await page.keyboard.press('ControlOrMeta+A');
}

const tb = (page: Page, key: string): Locator => page.getByTestId(`rcm-tb-${key}`);

/** Arrow keys until the toolbar control `key` has focus. */
async function arrowTo(page: Page, key: string) {
  for (let i = 0; i < 60 && (await focusedId(page)) !== `rcm-tb-${key}`; i++) {
    await page.keyboard.press('ArrowRight');
  }
  expect(await focusedId(page)).toBe(`rcm-tb-${key}`);
}

test('default is the full preset, ?toolbar=simple the simple preset', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('toolbar')).toBeVisible();
  expect((await tbIds(page)).sort()).toEqual(presetIds('full').sort());
  await page.goto('/?toolbar=simple');
  await expect(page.getByRole('toolbar')).toBeVisible();
  expect((await tbIds(page)).sort()).toEqual(presetIds('simple').sort());
  await page.goto('/?toolbar=none');
  await expect(page.getByTestId('editor-content')).toBeVisible();
  await expect(page.getByRole('toolbar')).toHaveCount(0);
});

test('injected sentinel labels reach every toolbar button (aria-label and title)', async ({
  page,
}) => {
  await page.goto('/?labels=sentinel');
  await expect(page.getByRole('toolbar')).toBeVisible();
  const rows = await page.locator('button[data-testid^="rcm-tb-"]').evaluateAll((els) =>
    els.map((el) => ({
      id: el.getAttribute('data-testid') as string,
      label: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
    })),
  );
  expect(rows.length).toBeGreaterThan(20);
  for (const row of rows) {
    expect(row.label).toBe(`SENTINEL_${row.id.replace('rcm-tb-', '')}`);
    expect(row.title).toBe(row.label);
  }
  await expect(page.getByRole('toolbar')).toHaveAttribute('aria-label', 'SENTINEL_toolbar');
  expect(Object.keys(DEFAULT_EDITOR_LABELS)).toContain('more');
});

test('fonts prop lists only those fonts (plus default); selection writes the stack', async ({
  page,
}) => {
  await page.goto('/?fonts=custom');
  await typeAndSelect(page);
  await tb(page, 'fontFamily').click();
  const options = page.getByTestId('rcm-tbo-fontFamily');
  expect(await options.evaluateAll((els) => els.map((e) => e.getAttribute('data-value')))).toEqual([
    '',
    "'Alpha Test', serif",
    "'Beta Test', monospace",
  ]);
  await page
    .locator('[data-testid="rcm-tbo-fontFamily"][data-value="\'Beta Test\', monospace"]')
    .click();
  expect(await docJson(page)).toContain(`"fontFamily":"'Beta Test', monospace"`);
  await expect(page.getByTestId('editor-content')).toBeFocused();
});

test('without fonts the built-in OFL list is offered', async ({ page }) => {
  await page.goto('/');
  await tb(page, 'fontFamily').click();
  const values = await page
    .getByTestId('rcm-tbo-fontFamily')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-value') ?? ''));
  expect(values.length).toBe(6);
  expect(values.slice(1).join('|')).toContain('Pretendard');
});

test('size menu is in pt and selection writes "<n>pt"', async ({ page }) => {
  await page.goto('/');
  await typeAndSelect(page);
  await tb(page, 'fontSize').click();
  const values = await page
    .getByTestId('rcm-tbo-fontSize')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-value')));
  expect(values).toEqual(
    ['8', '9', '10', '10.5', '11', '12', '14', '16', '18', '20', '24', '28', '32', '36'].map(
      (n) => `${n}pt`,
    ),
  );
  await page.locator('[data-testid="rcm-tbo-fontSize"][data-value="18pt"]').click();
  expect(await docJson(page)).toContain('"fontSize":"18pt"');
});

test('without an explicit size the size trigger shows the rendered size in pt', async ({
  page,
}) => {
  await page.goto('/');
  const trigger = page.locator('[data-testid="rcm-tb-fontSize"] .rcm-tb-menu-text');
  const shown = () => trigger.getAttribute('data-value');
  // Rendered size of the caret's paragraph, in pt rounded to 0.5.
  const renderedPt = () =>
    page.getByTestId('editor-content').evaluate((root) => {
      const sel = window.getSelection();
      const node = sel?.anchorNode ?? root;
      const el = node instanceof Element ? node : (node.parentElement ?? root);
      return String(Math.round(parseFloat(getComputedStyle(el).fontSize) * 0.75 * 2) / 2);
    });
  // Shown right after load, before the editor is touched.
  await expect.poll(shown).toMatch(/^\d+(\.5)?$/);
  await page.getByTestId('editor-content').click();
  await page.keyboard.type('body');
  await expect.poll(shown).toBe(await renderedPt());
  const body = Number(await shown());
  // A heading renders larger, and the trigger follows the caret.
  await tb(page, 'heading').click();
  await page.locator('[data-testid="rcm-tbo-heading"][data-value="1"]').click();
  await expect.poll(async () => Number(await shown())).toBeGreaterThan(body);
  // An explicit size wins.
  await page.keyboard.press('ControlOrMeta+A');
  await tb(page, 'fontSize').click();
  await page.locator('[data-testid="rcm-tbo-fontSize"][data-value="18pt"]').click();
  await expect.poll(shown).toBe('18');
});

test('palette and custom colours are stored as lowercase #rrggbb', async ({ page }) => {
  await page.goto('/');
  await typeAndSelect(page);
  await tb(page, 'color').click();
  await page.getByTestId('rcm-tbo-color-swatch').nth(6).click();
  expect(await docJson(page)).toMatch(/"color":"#[0-9a-f]{6}"/);

  await tb(page, 'highlight').click();
  await page.getByTestId('rcm-tbo-highlight-custom').fill('#FFAA00');
  expect(await docJson(page)).toContain('"color":"#ffaa00"');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('editor-content')).toBeFocused();

  await tb(page, 'color').click();
  await page.getByTestId('rcm-tbo-color-custom').fill('#00AA11');
  expect(await docJson(page)).toContain('"color":"#00aa11"');
  await page.getByTestId('rcm-tbo-color-remove').click();
  expect(await docJson(page)).not.toContain('"color":"#00aa11"');
});

test('toolbar role and aria-pressed follow the mark state', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('toolbar')).toBeVisible();
  await page.getByTestId('editor-content').click();
  await expect(tb(page, 'bold')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('ControlOrMeta+B');
  await expect(tb(page, 'bold')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.type('x');
  await page.keyboard.press('ControlOrMeta+A');
  await tb(page, 'italic').click();
  await expect(tb(page, 'italic')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('editor-content')).toBeFocused();
  await tb(page, 'bold').click();
  await expect(tb(page, 'bold')).toHaveAttribute('aria-pressed', 'false');
  expect(await docJson(page)).toContain('"italic"');
});

test('keyboard only: one Tab stop, arrows reach every command, Enter runs, Esc returns focus', async ({
  page,
}) => {
  await page.goto('/');
  await typeAndSelect(page);
  // Shift+Tab from the editor lands on the single toolbar Tab stop.
  await page.keyboard.press('Shift+Tab');
  expect(await page.locator('[data-rcm-ctl][tabindex="0"]').count()).toBe(1);
  await expect(page.locator('[data-rcm-ctl]:focus')).toHaveCount(1);

  const seen: string[] = [];
  await page.keyboard.press('Home');
  const total = await page.locator('[data-rcm-ctl]:not([disabled])').count();
  for (let i = 0; i < total; i++) {
    seen.push((await focusedId(page)) as string);
    await page.keyboard.press('ArrowRight');
  }
  expect(new Set(seen).size).toBe(total);
  expect(seen).toContain('rcm-tb-link');
  expect(seen).toContain('rcm-tb-clearFormat');
  // wraps around
  expect(await focusedId(page)).toBe(seen[0]);

  // Enter on a toggle runs the command and focus goes back to the editing area.
  await arrowTo(page, 'bold');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('editor-content')).toBeFocused();
  expect(await docJson(page)).toContain('"bold"');

  // Menus: open with the keyboard, pick with Enter.
  await page.keyboard.press('Shift+Tab');
  await arrowTo(page, 'fontSize');
  await page.keyboard.press('Enter');
  await expect(tb(page, 'fontSize')).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('editor-content')).toBeFocused();
  expect(await docJson(page)).toContain('"fontSize"');

  // Esc closes menus and popovers and refocuses the editing area.
  for (const key of ['fontFamily', 'color', 'link']) {
    await page.keyboard.press('Shift+Tab');
    await arrowTo(page, key);
    await page.keyboard.press('Enter');
    await expect(tb(page, key)).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(tb(page, key)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('editor-content')).toBeFocused();
  }
});

test('the link popover applies a link from the keyboard', async ({ page }) => {
  await page.goto('/');
  await typeAndSelect(page);
  await tb(page, 'link').click();
  await expect(page.getByTestId('rcm-tbo-link-url')).toBeFocused();
  await page.keyboard.type('https://example.com');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('editor-content')).toBeFocused();
  expect(await docJson(page)).toContain('"href":"https://example.com"');
});

test('at 360px the toolbar never scrolls and overflowing items are in the more menu', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  const bar = page.getByRole('toolbar');
  await expect(tb(page, 'more')).toBeVisible();
  await expect.poll(() => bar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const onBar = await tbIds(page);
  expect(onBar).toContain('rcm-tb-undo');
  await tb(page, 'more').click();
  const all = await tbIds(page);
  expect(all.filter((id) => id !== 'rcm-tb-more').sort()).toEqual(presetIds('full').sort());
  expect(onBar.length).toBeLessThan(all.length);
  // The panel stays inside the viewport and the editor root does not overflow.
  const box = await page.locator('.rcm-tb-panel--more').boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 360).toBe(true);
  expect(await page.locator('.rcm-editor').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  // Esc closes the panel and refocuses the editor.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('editor-content')).toBeFocused();
  // An overflowed command works from the panel.
  await page.keyboard.type('hi');
  await page.keyboard.press('ControlOrMeta+A');
  await tb(page, 'more').click();
  await page.locator('.rcm-tb-panel--more').getByTestId('rcm-tb-strike').click();
  expect(await docJson(page)).toContain('"strike"');
  // Widening the window returns every item to the bar (the full preset needs ~1.4k px).
  await page.setViewportSize({ width: 1600, height: 800 });
  await expect(tb(page, 'more')).toHaveCount(0);
  expect((await tbIds(page)).sort()).toEqual(presetIds('full').sort());
});

test('inside a host grid item (min-width: auto) the toolbar folds instead of widening the host', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  // Host pattern of a typical form layout: `<form class="grid">` > `<div>` > editor. A grid
  // item's automatic minimum size is its min-content width, so a nowrap toolbar would widen it.
  await page.locator('.rcm-editor').evaluate((editor) => {
    const grid = document.createElement('div');
    grid.id = 'host-grid';
    grid.style.cssText = 'display:grid;width:480px';
    const item = document.createElement('div');
    editor.replaceWith(grid);
    grid.appendChild(item);
    item.appendChild(editor);
  });
  await expect(tb(page, 'more')).toBeVisible();
  // The bar renders every entry once to measure them before folding; wait for the folded state.
  await expect
    .poll(() =>
      page.locator('#host-grid').evaluate((grid) => ({
        grid: grid.scrollWidth <= 480,
        editor:
          (grid.querySelector('.rcm-editor') as HTMLElement).getBoundingClientRect().width <= 480,
      })),
    )
    .toEqual({ grid: true, editor: true });
});

test('overflow "wrap" wraps the bar onto more lines and keeps every item visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await page.goto('/?toolbarOverflow=wrap');
  const bar = page.getByRole('toolbar');
  await expect(tb(page, 'source')).toBeVisible();
  await expect(tb(page, 'more')).toHaveCount(0);
  expect((await tbIds(page)).sort()).toEqual(presetIds('full').sort());
  // Several lines, no horizontal scroll, and the editor stays inside the viewport.
  const box = await bar.boundingBox();
  const undo = await tb(page, 'undo').boundingBox();
  expect(box && undo && box.height > undo.height * 2).toBe(true);
  expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(
    await page.locator('.rcm-editor').evaluate((el) => el.getBoundingClientRect().right <= 600),
  ).toBe(true);
  // A wrapped item still works.
  await typeAndSelect(page);
  await tb(page, 'strike').click();
  expect(await docJson(page)).toContain('"strike"');
});

test('dark tokens change the toolbar colours and keep contrast >= 4.5', async ({ page }) => {
  const read = () =>
    page.evaluate(() => {
      const bar = document.querySelector('.rcm-tb') as HTMLElement;
      const btn = document.querySelector('[data-testid="rcm-tb-bold"]') as HTMLElement;
      const root = getComputedStyle(document.documentElement);
      const lum = (css: string) => {
        const c = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
        c.fillStyle = css;
        c.fillRect(0, 0, 1, 1);
        const d = c.getImageData(0, 0, 1, 1).data;
        const f = (v: number) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(d[0] as number) + 0.7152 * f(d[1] as number) + 0.0722 * f(d[2] as number);
      };
      const ratio = (a: string, b: string) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return ((hi as number) + 0.05) / ((lo as number) + 0.05);
      };
      const bg = getComputedStyle(bar).backgroundColor;
      return {
        token: root.getPropertyValue('--rcm-editor-toolbar-bg').trim(),
        menu: root.getPropertyValue('--rcm-editor-menu-bg').trim(),
        bg,
        toolbarContrast: ratio(getComputedStyle(btn).color, bg),
        menuContrast: ratio(
          root.getPropertyValue('--rcm-editor-menu-fg').trim(),
          root.getPropertyValue('--rcm-editor-menu-bg').trim(),
        ),
      };
    });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.getByRole('toolbar')).toBeVisible();
  // The playground pins data-theme=light; drop it so the media query decides.
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  const light = await read();
  await page.emulateMedia({ colorScheme: 'dark' });
  const dark = await read();
  expect(dark.token).not.toBe(light.token);
  expect(dark.menu).not.toBe(light.menu);
  expect(dark.bg).not.toBe(light.bg);
  for (const r of [light, dark]) {
    expect(r.toolbarContrast).toBeGreaterThanOrEqual(4.5);
    expect(r.menuContrast).toBeGreaterThanOrEqual(4.5);
  }
  // the explicit attribute works too
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  expect((await read()).token).toBe(dark.token);
});
