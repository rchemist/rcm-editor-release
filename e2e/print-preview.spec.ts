// 인쇄 미리보기: 프레임 내용 = renderPrintHtml 결과 + 다쪽 페이지,
// "PDF 저장" → 주입 exportPdf 1회, 인자 = 미리보기 HTML. 테스트 페이지 print.html.
import { expect, test } from '@playwright/test';

const FRAME_SEL = '[data-testid="rcm-print-frame"]';

/** 다쪽 표본이 페이지로 나뉠 때까지 기다린 뒤 확정된 쪽 수를 돌려준다. */
async function pageCount(page: import('@playwright/test').Page): Promise<number> {
  await expect
    .poll(async () =>
      Number(await page.getByTestId('rcm-print-page-count').getAttribute('data-count')),
    )
    .toBeGreaterThanOrEqual(2);
  return Number(await page.getByTestId('rcm-print-page-count').getAttribute('data-count'));
}

test('the frame carries the renderPrintHtml output and a multi-page fixture paginates', async ({
  page,
}) => {
  await page.goto('/print.html');

  // The preview iframe is the sandboxed, script-less renderPrintHtml document (its srcdoc is
  // untouched by the in-frame pagination, which only re-lays the DOM inside).
  const matches = await page.evaluate((selector) => {
    const frame = document.querySelector<HTMLIFrameElement>(selector);
    const hook = window as unknown as { __rcmPrint?: { html: string } };
    return { srcdoc: frame?.getAttribute('srcdoc') ?? '', expected: hook.__rcmPrint?.html ?? '' };
  }, FRAME_SEL);
  expect(matches.srcdoc).toBe(matches.expected);
  await expect(page.locator(FRAME_SEL)).toHaveAttribute('sandbox', 'allow-same-origin');

  // The 80-row fixture must paginate: ≥ 2 pages, matching the toolbar count.
  const count = await pageCount(page);
  const content = page.frameLocator(FRAME_SEL);
  await expect(content.locator('[data-testid="rcm-print-page"]')).toHaveCount(count);

  // Content survived the re-lay: first and last table rows are in the pages, and the header
  // row repeats on every table page (page 1 holds the title, paragraph and the forced break).
  await expect(content.getByText('행 1-1')).toBeVisible();
  await expect(content.getByText('행 80-3')).toBeVisible();
  await expect(content.locator('thead')).toHaveCount(count - 1);
  // Screen emulation of the footer margin box: "현재 / 전체" per page.
  await expect(content.locator('.rcm-print-margin-bottom').first()).toHaveText(/^1 \/ \d+$/);
  await expect(content.locator('.rcm-print-margin-bottom').last()).toHaveText(
    new RegExp(`^${count} / ${count}$`),
  );
});

test('"PDF 저장" calls the injected exportPdf once with the preview html', async ({ page }) => {
  await page.goto('/print.html');
  await pageCount(page);

  const button = page.getByTestId('rcm-print-export');
  await expect(button).toBeEnabled();
  await button.click();

  const result = await page.evaluate(() => {
    const hook = window as unknown as {
      __rcmExportCalls?: string[];
      __rcmPrint?: { html: string };
    };
    return { calls: hook.__rcmExportCalls ?? [], expected: hook.__rcmPrint?.html ?? '' };
  });
  expect(result.calls).toHaveLength(1);
  expect(result.calls[0]).toBe(result.expected);
});
