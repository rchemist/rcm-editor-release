// 접근성: 플레이그라운드 각 상태에서 axe serious·critical 0,
// 다크 모드: 미디어 에뮬레이션·토큰 속성 두 경로 모두 토큰 변경 + color-contrast 0.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** A tiny offline image so the document has real <img> elements without network. */
const demoSvg = (label: string): string =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60">` +
      `<rect width="100%" height="100%" fill="#dbeafe"/><text x="8" y="34" ` +
      `font-family="sans-serif" font-size="14" fill="#1e40af">${label}</text></svg>`,
  )}`;

/** A document with a table (header row + merged cell) and images, loaded through the live editor. */
const cell = (text: string, extra = '') => `<td${extra}><p>${text}</p></td>`;
const head = (text: string) => `<th><p>${text}</p></th>`;
// The editor's own HTML puts header cells as <th> rows inside <tbody> (a hand-written <thead>
// element is preserved verbatim as rawHtml instead of parsing).
const tableImageDoc =
  '<p>표와 그림이 함께 있는 문서 단락입니다.</p>' +
  `<table><tbody><tr>${head('항목')}${head('값')}${head('비고')}</tr>` +
  `<tr>${cell('가')}${cell('1')}${cell('병합', ' rowspan="2"')}</tr>` +
  `<tr>${cell('나')}${cell('2')}</tr></tbody></table>` +
  `<p>앞 <img src="${demoSvg('인라인')}" alt="인라인 그림"> 뒤</p>` +
  `<figure><img src="${demoSvg('블록')}" alt="블록 그림"><figcaption>그림 캡션</figcaption></figure>` +
  '<p></p>';

async function openPlayground(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.getByRole('toolbar')).toBeVisible();
  await page.waitForFunction(() => !!window.__rcmPlayground);
}

/** Loads `html` into the live editor (the playground test hook). */
async function setContent(page: Page, html: string): Promise<void> {
  await page.evaluate((h) => void window.__rcmPlayground?.editor.commands.setContent(h), html);
  await expect(page.getByTestId('editor-content').locator('table')).toBeVisible();
}

type AxeViolation = { id: string; impact: string | null; nodes: number; help: string };

/** axe serious·critical 위반 목록(보기 좋게 요약).
 *
 * `legacy` = in-page `axe.run`: the editor renders preserved raw HTML (and the print preview)
 * inside `sandbox="allow-same-origin"` iframes where scripts can never run — the default
 * runPartial/finishRun flow waits on those frames forever, while the in-page run completes. */
async function seriousViolations(page: Page, legacy = false): Promise<AxeViolation[]> {
  const builder = new AxeBuilder({ page });
  const results = await (legacy ? builder.setLegacyMode(true) : builder).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help }));
}

/** 판정: serious·critical 0 (실패 시 위반 요약이 메시지에 남는다). */
async function expectAxeClean(page: Page, state: string, legacy = false): Promise<void> {
  const found = await seriousViolations(page, legacy);
  expect(
    found,
    `axe serious/critical violations in state "${state}": ${JSON.stringify(found)}`,
  ).toEqual([]);
}

// --- 플레이그라운드(full 프리셋) 각 상태 ------------------------------------------

test('playground (full preset) with table and image fixtures', async ({ page }) => {
  await openPlayground(page);
  await setContent(page, tableImageDoc);
  await expectAxeClean(page, 'table+image document');
});

test('with the table menu open', async ({ page }) => {
  await openPlayground(page);
  await setContent(page, tableImageDoc);
  const cell = page.getByTestId('editor-content').locator('td').first();
  await cell.click({ button: 'right' });
  await expect(page.getByTestId('rcm-table-menu')).toBeVisible();
  await expectAxeClean(page, 'table menu open');
});

test('with the image toolbar open', async ({ page }) => {
  await openPlayground(page);
  await setContent(page, tableImageDoc);
  // Focus first: the first click into an unfocused editor does not move ProseMirror's selection.
  await page.getByTestId('editor-content').click();
  await page.getByTestId('editor-content').locator('figure img').click();
  await expect(page.getByTestId('rcm-image-bar')).toBeVisible();
  await expectAxeClean(page, 'image toolbar open');
});

test('with the find panel open', async ({ page }) => {
  await openPlayground(page);
  await setContent(page, tableImageDoc);
  await page.getByTestId('editor-content').click();
  await page.keyboard.type('one two one');
  await page.getByTestId('rcm-tb-find').click();
  await expect(page.getByTestId('rcm-find-panel')).toBeVisible();
  await expectAxeClean(page, 'find panel open');
});

test('with the source mode notice shown', async ({ page }) => {
  await openPlayground(page);
  await page.getByTestId('rcm-tb-source').click();
  await page.waitForFunction(() => {
    const host = document.querySelector('[data-testid="rcm-source-editor"]') as
      (HTMLElement & { __rcmCodeMirror?: unknown }) | null;
    return !!host?.__rcmCodeMirror;
  });
  const source = page.getByTestId('rcm-source-editor');
  await source.click();
  await page.keyboard.press('ControlOrMeta+a');
  // A schema-unknown fragment (kept as rawHtml) + a policy removal (script) → the notice shows.
  await page.keyboard.type('<p>hi</p><style>.a{color:red}</style><script>bad()</script>');
  await page.getByTestId('rcm-tb-source').click();
  await expect(page.getByTestId('rcm-html-notice')).toBeVisible();
  // The applied source keeps <style> as rawHtml → a sandboxed iframe (see seriousViolations).
  await expectAxeClean(page, 'source mode notice', true);
});

test('print preview page', async ({ page }) => {
  await page.goto('/print.html');
  await expect
    .poll(async () =>
      Number(await page.getByTestId('rcm-print-page-count').getAttribute('data-count')),
    )
    .toBeGreaterThanOrEqual(2);
  // The preview itself is a sandboxed iframe (scripts cannot run inside), so the shell is
  // scanned in-page and the preview document separately, loaded as its own page.
  await expectAxeClean(page, 'print preview', true);
  const srcdoc = await page.getByTestId('rcm-print-frame').getAttribute('srcdoc');
  expect(srcdoc, 'preview iframe content').toBeTruthy();
  const content = await page.context().newPage();
  try {
    await content.setContent(srcdoc!);
    await expectAxeClean(content, 'print preview document');
  } finally {
    await content.close();
  }
});

// --- 다크 모드 두 경로 ---------------------------------------------------------------

/** 대표 토큰 값 읽기(라이트/다크 비교용). */
const readTokens = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return [
      '--rcm-editor-color-bg',
      '--rcm-editor-color-fg',
      '--rcm-editor-toolbar-bg',
      '--rcm-editor-menu-bg',
      '--rcm-editor-color-warning-fg',
    ].map((name) => s.getPropertyValue(name).trim());
  });

test('dark mode via prefers-color-scheme emulation: tokens change, contrast clean', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openPlayground(page);
  await setContent(page, tableImageDoc);
  // The playground pins data-theme=light; drop it so the media query decides.
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  const light = await readTokens(page);

  await page.emulateMedia({ colorScheme: 'dark' });
  const dark = await readTokens(page);
  for (const [i, value] of dark.entries()) expect(value, `token ${i} changed`).not.toBe(light[i]);

  // Body + tooltip surfaces: a menu panel open while scanning color-contrast only.
  await page.getByTestId('rcm-tb-fontFamily').click();
  await expect(page.getByTestId('rcm-tbo-fontFamily').first()).toBeVisible();
  const violations = await new AxeBuilder({ page })
    .withRules(['color-contrast'])
    .analyze()
    .then((r) => r.violations.map((v) => ({ id: v.id, nodes: v.nodes.length })));
  expect(violations).toEqual([]);
  await page.keyboard.press('Escape');

  // The explicit token attribute wins over the light media query.
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  expect(await readTokens(page)).toEqual(dark);

  const attrViolations = await new AxeBuilder({ page })
    .withRules(['color-contrast'])
    .analyze()
    .then((r) => r.violations.map((v) => ({ id: v.id, nodes: v.nodes.length })));
  expect(attrViolations).toEqual([]);
});
