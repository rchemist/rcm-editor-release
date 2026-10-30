import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// security boundary in the default `sanitize` mode: no content path may run script in the
// host page or cover the host UI. The playground default (`/`) is the sanitize policy.

/** Marker a successful payload would set on the host `window`. */
const MARKER = '__rcmSecPwned';

const marker = (page: Page) =>
  page.evaluate((name) => (window as unknown as Record<string, unknown>)[name], MARKER);

/** The sandboxed preview frame of the first raw block. */
async function previewFrame(page: Page) {
  const host = page.locator('[data-rcm-raw-html-preview] iframe');
  await expect(host).toHaveCount(1);
  return host;
}

/** `editor.getHTML()` runs inside the page (the live editor does not survive serialization). */
const editorHtml = (page: Page) =>
  page.evaluate(() => window.__rcmPlayground?.editor.getHTML() ?? '');

test('SEC-1 onerror via a smuggled placeholder (HTML setContent) never runs and is stored clean', async ({
  page,
}) => {
  await page.goto('/');
  const area = page.getByTestId('editor-content');
  await expect(area).toBeVisible();
  await area.click();
  const placeholder =
    '<div data-rcm-raw-html="&lt;img src=x onerror=&quot;window.top.__rcmSecPwned=true&quot;&gt;"></div>';
  await page.evaluate(
    (html) => void window.__rcmPlayground?.editor.commands.setContent(html),
    `<p>a</p>${placeholder}`,
  );

  const frame = await previewFrame(page);
  // Non-trusted preview: script-less, same-origin for height measuring only.
  expect(await frame.getAttribute('sandbox')).toBe('allow-same-origin');
  // The input point sanitized the payload: nothing runs, nothing dirty is stored.
  expect(await marker(page)).toBeUndefined();
  const html = await editorHtml(page);
  expect(html).not.toContain('onerror');
  expect(html).toContain('<img src="x">');
});

test('SEC-1 onerror via stored JSON (setContent) never runs and is stored clean', async ({
  page,
}) => {
  await page.goto('/');
  const area = page.getByTestId('editor-content');
  await expect(area).toBeVisible();
  await area.click();
  await page.evaluate((json) => void window.__rcmPlayground?.editor.commands.setContent(json), {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
      {
        type: 'rawHtml',
        attrs: { html: '<img src=x onerror="window.top.__rcmSecPwned=true">' },
      },
    ],
  });

  const frame = await previewFrame(page);
  expect(await frame.getAttribute('sandbox')).toBe('allow-same-origin');
  expect(await marker(page)).toBeUndefined();
  const stored = await page.evaluate(() =>
    JSON.stringify(window.__rcmPlayground?.getLosslessJSON()),
  );
  expect(stored).not.toContain('onerror');
});

test('SEC-3 an SVG animate link click does nothing (the javascript: target is removed at input)', async ({
  page,
}) => {
  await page.goto('/');
  const area = page.getByTestId('editor-content');
  await expect(area).toBeVisible();
  await area.click();
  await page.evaluate(
    (html) => void window.__rcmPlayground?.editor.commands.setContent(html),
    '<p>b</p><svg width="80" height="24"><a href="#go"><text x="4" y="16">golink</text>' +
      '<animate attributeName="href" values="#go;javascript:window.top.__rcmSecPwned=true" ' +
      'dur="1s" repeatCount="indefinite"/></a></svg>',
  );

  // The animated javascript: URL was removed with a report; nothing dangerous is stored.
  expect(await editorHtml(page)).not.toContain('javascript:');

  // Clicking the link inside the preview stays inert (the frame has no scripting at all).
  const raw = page
    .frames()
    .filter((frame) => frame !== page.mainFrame() && !frame.url().startsWith('http'))
    .find((frame) => frame.url().includes('about:srcdoc') || frame.url() === 'about:blank');
  expect(raw).toBeDefined();
  await raw!.getByText('golink').click();
  expect(await marker(page)).toBeUndefined();
});

test('SEC-4 a position:fixed raw block cannot cover the toolbar (confined to the preview frame)', async ({
  page,
}) => {
  await page.goto('/');
  const area = page.getByTestId('editor-content');
  await expect(area).toBeVisible();
  await area.click();
  await page.evaluate(
    (html) => void window.__rcmPlayground?.editor.commands.setContent(html),
    '<p>c</p><div style="position:fixed;top:0;left:0;width:100vw;height:100vh;' +
      'z-index:2147483647;background:rgba(255,0,0,.9)">' +
      '<form action="javascript:window.top.__rcmSecPwned=true"><button type="submit">go</button></form>' +
      '</div>',
  );

  // The overlay exists — inside the preview iframe (computed style: no attribute-text
  // dependency), never in the host document. `srcdoc` loads asynchronously, so poll.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const frame = document.querySelector(
          '[data-rcm-raw-html-preview] iframe',
        ) as HTMLIFrameElement | null;
        const overlay = frame?.contentDocument?.querySelector('div');
        return overlay ? getComputedStyle(overlay).position : '';
      }),
    )
    .toBe('fixed');

  // The toolbar is still the topmost element at its own position.
  const toolbar = page.getByTestId('rcm-tb-source');
  const box = await toolbar.boundingBox();
  expect(box).not.toBeNull();
  const hit = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return !!el && !!el.closest('[data-testid="rcm-tb-source"]');
    },
    { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
  );
  expect(hit).toBe(true);

  // The form's javascript: action never runs anywhere.
  expect(await marker(page)).toBeUndefined();
});
