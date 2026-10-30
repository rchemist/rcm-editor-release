import { expect, test } from '@playwright/test';

type Page = import('@playwright/test').Page;

/**
 * Waits until the source editor's CodeMirror view is actually mounted (the host div renders
 * immediately; the editor arrives with the lazy chunk) and returns its document text.
 */
async function readSourceText(page: Page): Promise<string> {
  await page.waitForFunction(() => {
    const host = document.querySelector('[data-testid="rcm-source-editor"]') as
      ({ __rcmCodeMirror?: unknown } | null) | null;
    return !!host?.__rcmCodeMirror;
  });
  return page.evaluate(() => {
    const host = document.querySelector('[data-testid="rcm-source-editor"]') as
      (HTMLElement & { __rcmCodeMirror?: { state: { doc: { toString(): string } } } }) | null;
    return host?.__rcmCodeMirror?.state.doc.toString() ?? '';
  });
}

/** The playground hook exposes the live editor (set once the app has mounted). */
async function editorText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const pg = (
      window as { __rcmPlayground?: { editor: { state: { doc: { textContent: string } } } } }
    ).__rcmPlayground;
    return pg ? pg.editor.state.doc.textContent : '';
  });
}

/** `getHTML()` must run inside the page: the live editor does not survive serialization. */
async function editorHtml(page: Page): Promise<string> {
  return page.evaluate(() => {
    const pg = (window as { __rcmPlayground?: { editor: { getHTML(): string } } }).__rcmPlayground;
    return pg ? pg.editor.getHTML() : '';
  });
}

test('the source entry shows the lossless HTML verbatim; an unchanged exit keeps the history', async ({
  page,
}) => {
  await page.goto('/?html=raw');
  const area = page.getByTestId('editor-content');
  // An edit before entering the source mode gives the history something to prove.
  await area.click();
  await page.keyboard.type('A');
  await page.getByTestId('rcm-tb-source').click();
  await expect(page.getByTestId('rcm-source-editor')).toBeVisible();
  await expect(page.getByTestId('rcm-tb-source')).toHaveAttribute('aria-pressed', 'true');
  // The editing area is hidden while the source editor replaces it.
  await expect(area).toBeHidden();
  // Non-round-tripping blocks appear byte-verbatim, never normalized or dropped.
  const text = await readSourceText(page);
  expect(text).toContain('<div class="kept"><p>래퍼 div 안 문단</p></div>');
  expect(text).toContain('<style>.kept { color: red; }</style>');
  // Unchanged exit: no apply, no document touch — the pre-entry undo step is still reachable.
  await page.getByTestId('rcm-tb-source').click();
  await expect(page.getByTestId('rcm-source-editor')).toHaveCount(0);
  await expect(area).toBeVisible();
  await expect(area).toBeFocused();
  await page.keyboard.press('ControlOrMeta+z');
  expect(await editorText(page)).not.toContain('A');
});

test('a changed source applies in one transaction (single undo restores)', async ({ page }) => {
  await page.goto('/?html=raw');
  const area = page.getByTestId('editor-content');
  await expect(area).toBeVisible();
  const before = await editorHtml(page);
  await page.getByTestId('rcm-tb-source').click();
  await readSourceText(page); // wait until typing can land in the CodeMirror view
  const source = page.getByTestId('rcm-source-editor');
  await source.click();
  // A plain-text replacement (tag typing is covered by the notice test below).
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('source-applied');
  await page.getByTestId('rcm-tb-source').click();
  await expect(area).toBeVisible();
  await expect(area).toContainText('source-applied');
  // Exactly one undo step: the pre-apply document comes back whole.
  await expect(area).toBeFocused();
  await page.keyboard.press('ControlOrMeta+z');
  expect(await editorHtml(page)).toBe(before);
});

test('a source apply reports kept fragments and policy removals in the notice', async ({
  page,
}) => {
  await page.goto('/');
  // No notice for the initial load, even with non-round-tripping content.
  await expect(page.getByTestId('rcm-html-notice')).toHaveCount(0);
  await page.getByTestId('rcm-tb-source').click();
  await readSourceText(page); // wait until typing can land in the CodeMirror view
  const source = page.getByTestId('rcm-source-editor');
  await source.click();
  await page.keyboard.press('ControlOrMeta+a');
  // autoCloseTags may add a closing tag while typing: the assertions below are reason-based,
  // so the exact serialized text can carry a harmless duplicated close tag.
  await page.keyboard.type('<p>hi</p><script>bad()</script><style>.a{color:red}</style>');
  await page.getByTestId('rcm-tb-source').click();
  const notice = page.getByTestId('rcm-html-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute('role', 'status');
  const reasons = await page
    .locator('[data-testid="rcm-html-notice-item"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-reason')));
  expect(reasons).toContain('element'); // <style> kept verbatim as rawHtml
  expect(reasons).toContain('script'); // the sanitize policy removed the script
  // Closing the notice is only a dismissal — the raw fragment stays in the document.
  await page.getByTestId('rcm-html-notice-close').click();
  await expect(page.getByTestId('rcm-html-notice')).toHaveCount(0);
  await expect(page.getByTestId('editor-content')).toContainText('hi');
});

test('trusted previews are sandboxed and cannot reach the parent document', async ({ page }) => {
  await page.goto('/?htmlPolicy=trusted&html=raw');
  // Every raw fragment renders in its own iframe: scripts allowed, same origin NOT.
  const frames = page.locator('[data-rcm-raw-html-preview] iframe');
  await expect(frames.first()).toBeVisible();
  const sandbox = (await frames.first().getAttribute('sandbox')) ?? '';
  expect(sandbox).toContain('allow-scripts');
  expect(sandbox).not.toContain('allow-same-origin');
  // The inline script ran inside the sandbox (opaque origin) and never touched the parent.
  const raw = page
    .frames()
    .filter((frame) => frame !== page.mainFrame() && !frame.url().startsWith('http'))
    .find((frame) => frame.url().includes('about:srcdoc') || frame.url() === 'about:blank');
  expect(raw).toBeDefined();
  const origin = await raw!.evaluate(() => window.origin);
  expect(origin).toBe('null');
  expect(
    await page.evaluate(() => (window as { __rcmPwned?: boolean }).__rcmPwned),
  ).toBeUndefined();
  // The script itself is stored verbatim: the source editor shows it byte-for-byte.
  await page.getByTestId('rcm-tb-source').click();
  const text = await readSourceText(page);
  expect(text).toContain('<script>try{parent.__rcmPwned=true}catch(e){}</script>');
});

test('CodeMirror loads only on first entry; Mod-F is the source editor search', async ({
  page,
}) => {
  await page.goto('/');
  // The loader module itself is tiny and statically imported; the CodeMirror packages
  // (`@codemirror/*`, `@lezer/*`) must not arrive before the first source-mode entry.
  const codemirrorLoaded = () =>
    page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .some((entry) => /@codemirror|@lezer/.test(entry.name)),
    );
  expect(await codemirrorLoaded()).toBe(false);
  await page.getByTestId('rcm-tb-source').click();
  await expect(page.getByTestId('rcm-source-editor')).toBeVisible();
  await expect.poll(codemirrorLoaded).toBe(true);
  // In source mode Mod-F belongs to the source editor, not the find & replace panel. Wait for
  // the entry focus (the lazy mount takes the focus asynchronously after the chunk arrives).
  await expect(page.locator('.rcm-source .cm-content')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+F');
  await expect(page.locator('.cm-panel')).toBeVisible();
  await expect(page.getByTestId('rcm-find-panel')).toHaveCount(0);
});

test('sourceMode=false hides the toggle entirely', async ({ page }) => {
  await page.goto('/?sourceMode=0');
  await expect(page.getByTestId('rcm-tb-source')).toHaveCount(0);
  await expect(page.getByTestId('editor-content')).toBeVisible();
});
