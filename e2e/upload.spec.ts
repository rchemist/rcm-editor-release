import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// 1x1 transparent PNG.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

interface Json {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: Json[];
}

async function load(page: Page, query: string, html = '<p>before</p><p>after</p>') {
  await page.goto(`/?${query}`);
  await expect(page.getByTestId('editor-content')).toBeVisible();
  await page.getByTestId('editor-content').click();
  await page.evaluate((h) => void window.__rcmPlayground?.editor.commands.setContent(h), html);
}

const doc = (page: Page) =>
  page.evaluate(() => window.__rcmPlayground?.getLosslessJSON() as Json | undefined);

async function imageSrcs(page: Page): Promise<string[]> {
  const out: string[] = [];
  const walk = (n: Json) => {
    if (n.type === 'image' || n.type === 'inlineImage') out.push(String(n.attrs?.src));
    n.content?.forEach(walk);
  };
  walk((await doc(page)) ?? {});
  return out;
}

/** Fires a paste carrying an image file at the editing area. */
function pasteImage(page: Page, name: string) {
  return page.evaluate(
    ({ name, b64 }) => {
      const dt = new DataTransfer();
      dt.items.add(
        new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name, { type: 'image/png' }),
      );
      const target = document.querySelector('[data-testid="editor-content"]') as HTMLElement;
      target.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    },
    { name, b64: PNG_B64 },
  );
}

/** Fires a drop carrying an image file at the middle of the editing area. */
function dropImage(page: Page, name: string) {
  return page.evaluate(
    ({ name, b64 }) => {
      const dt = new DataTransfer();
      dt.items.add(
        new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name, { type: 'image/png' }),
      );
      const target = document.querySelector('[data-testid="editor-content"]') as HTMLElement;
      const box = target.getBoundingClientRect();
      target.dispatchEvent(
        new DragEvent('drop', {
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
          clientX: box.x + 20,
          clientY: box.y + 10,
        }),
      );
    },
    { name, b64: PNG_B64 },
  );
}

const calls = (page: Page) => page.evaluate(() => window.__rcmUploads?.calls.map((c) => c.name));

test('paste, drop and the toolbar file chooser each run the pipeline exactly once', async ({
  page,
}) => {
  await load(page, 'upload=manual');

  await pasteImage(page, 'pasted.png');
  await expect.poll(() => calls(page)).toEqual(['pasted.png']);

  await dropImage(page, 'dropped.png');
  await expect.poll(() => calls(page)).toEqual(['pasted.png', 'dropped.png']);

  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('rcm-tb-image').click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'chosen.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG_B64, 'base64'),
  });
  await expect.poll(() => calls(page)).toEqual(['pasted.png', 'dropped.png', 'chosen.png']);
  await expect(page.getByTestId('rcm-upload-placeholder')).toHaveCount(3);

  // Nothing was written to the document before the uploads finish.
  expect(await imageSrcs(page)).toEqual([]);
  await page.evaluate(() => {
    window.__rcmUploads?.calls.forEach((c, i) => c.resolve(`https://cdn.test/${i}.png`));
  });
  await expect(page.getByTestId('rcm-upload-placeholder')).toHaveCount(0);
  expect((await imageSrcs(page)).sort()).toEqual([
    'https://cdn.test/0.png',
    'https://cdn.test/1.png',
    'https://cdn.test/2.png',
  ]);
  expect(await calls(page)).toHaveLength(3);
});

test('a dropped image file runs the pipeline once and the result src becomes an image', async ({
  page,
}) => {
  await load(page, 'upload=manual');
  await dropImage(page, 'd.png');
  await expect.poll(() => calls(page)).toEqual(['d.png']);
  await page.evaluate(() =>
    window.__rcmUploads?.calls[0]?.resolve('asset:sha256:' + 'ab'.repeat(32)),
  );
  await expect.poll(() => imageSrcs(page)).toEqual(['asset:sha256:' + 'ab'.repeat(32)]);
  expect(await calls(page)).toHaveLength(1);
});

test('the toolbar file item uploads a non-image file and inserts a link with its name', async ({
  page,
}) => {
  await load(page, 'upload=manual');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('rcm-tb-file').click();
  const chooser = await chooserPromise;
  // No accept filter: any file can be attached.
  expect(await page.getByTestId('rcm-tbo-file-input').getAttribute('accept')).toBeNull();
  await chooser.setFiles({
    name: 'report.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 test'),
  });
  await expect.poll(() => calls(page)).toEqual(['report.pdf']);
  await page.evaluate(() => window.__rcmUploads?.calls[0]?.resolve('https://cdn.test/report.pdf'));
  const link = page.getByTestId('editor-content').locator('a');
  await expect(link).toHaveText('report.pdf');
  await expect(link).toHaveAttribute('href', 'https://cdn.test/report.pdf');
});

test('progress is shown while waiting; a failure leaves no image, shows the error, and retry works', async ({
  page,
}) => {
  await load(page, 'upload=manual');
  const before = JSON.stringify(await doc(page));
  await dropImage(page, 'p.png');
  const placeholder = page.getByTestId('rcm-upload-placeholder');
  await expect(placeholder).toBeVisible();
  await expect(placeholder).toHaveAttribute('aria-busy', 'true');

  const seen: string[] = [];
  for (const f of [0.25, 0.1, 0.6]) {
    await page.evaluate((v) => window.__rcmUploads?.calls[0]?.progress(v), f);
    seen.push((await placeholder.getAttribute('data-progress')) ?? '');
  }
  expect(seen).toEqual(['0.25', '0.25', '0.6']); // never goes back
  expect(JSON.stringify(await doc(page))).toBe(before);

  await page.evaluate(() => window.__rcmUploads?.calls[0]?.reject('boom'));
  await expect(page.getByTestId('rcm-upload-error')).toBeVisible();
  await expect(placeholder).toHaveCount(0);
  expect(JSON.stringify(await doc(page))).toBe(before);
  expect(await page.evaluate(() => window.__rcmUploads?.errors)).toEqual([
    { code: 'other', name: 'p.png' },
  ]);

  await page.getByTestId('rcm-upload-retry').click();
  await expect.poll(() => calls(page)).toEqual(['p.png', 'p.png']);
  await expect(placeholder).toBeVisible();
  await page.evaluate(() => window.__rcmUploads?.calls[1]?.resolve('https://cdn.test/ok.png'));
  await expect.poll(() => imageSrcs(page)).toEqual(['https://cdn.test/ok.png']);
  await expect(page.getByTestId('rcm-upload-error')).toHaveCount(0);
});

test('dismissing a pending placeholder aborts the upload and inserts no image', async ({
  page,
}) => {
  await load(page, 'upload=manual');
  await dropImage(page, 'x.png');
  await expect(page.getByTestId('rcm-upload-placeholder')).toBeVisible();
  await page.getByTestId('rcm-upload-dismiss').click();
  await expect(page.getByTestId('rcm-upload-placeholder')).toHaveCount(0);
  expect(await page.evaluate(() => window.__rcmUploads?.calls[0]?.aborted)).toBe(true);
  await page.evaluate(() => window.__rcmUploads?.calls[0]?.resolve('https://cdn.test/late.png'));
  expect(await imageSrcs(page)).toEqual([]);
});

test('with no uploader a chosen image becomes a base64 data URL; an oversized file is refused with the error state', async ({
  page,
}) => {
  await load(page, 'upload=default');
  const choose = async (file: { name: string; mimeType: string; buffer: Buffer }) => {
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByTestId('rcm-tb-image').click();
    await (await chooserPromise).setFiles(file);
  };
  await choose({
    name: 'small.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG_B64, 'base64'),
  });
  await expect.poll(() => imageSrcs(page)).toEqual([`data:image/png;base64,${PNG_B64}`]);

  const before = JSON.stringify(await doc(page));
  await choose({
    name: 'huge.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
  });
  await expect(page.getByTestId('rcm-upload-error')).toHaveAttribute('data-error-code', 'size');
  expect(JSON.stringify(await doc(page))).toBe(before);
});

/** Bytes of the multipart part named `file`. */
function filePart(body: Buffer): Buffer {
  const text = body.toString('latin1');
  const boundary = text.slice(0, text.indexOf('\r\n'));
  const start = text.indexOf('\r\n\r\n', text.indexOf('name="file"')) + 4;
  const end = text.indexOf(`\r\n${boundary}`, start);
  return body.subarray(start, end);
}

/** A noisy 400x300 PNG made by the browser. */
async function bigPng(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 300;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(400, 300);
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = (i * 7) % 256;
      image.data[i + 1] = (i * 13) % 256;
      image.data[i + 2] = (i * 29) % 256;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  });
  return Buffer.from(b64, 'base64');
}

async function sendThroughHttp(page: Page, query: string, original: Buffer) {
  let sent: Buffer | null = null;
  let headers: Record<string, string> = {};
  await page.route('**/__upload', async (route) => {
    sent = filePart(route.request().postDataBuffer() ?? Buffer.alloc(0));
    headers = route.request().headers();
    await route.fulfill({ json: { url: 'https://cdn.test/up.png' } });
  });
  await load(page, query);
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('rcm-tb-image').click();
  await (
    await chooserPromise
  ).setFiles({ name: 'big.png', mimeType: 'image/png', buffer: original });
  await expect.poll(() => imageSrcs(page)).toEqual(['https://cdn.test/up.png']);
  return { sent: sent as Buffer | null, headers };
}

test('without resize the original bytes are sent; with resize the sent image is smaller in size and dimensions', async ({
  page,
}) => {
  const original = await bigPng(page);

  const off = await sendThroughHttp(page, 'upload=http', original);
  expect(off.headers['x-playground']).toBe('1');
  expect(off.sent).not.toBeNull();
  expect(createHash('sha256').update(off.sent!).digest('hex')).toBe(
    createHash('sha256').update(original).digest('hex'),
  );

  const on = await sendThroughHttp(page, 'upload=http&resize=1', original);
  expect(on.sent).not.toBeNull();
  expect(on.sent!.length).toBeLessThan(original.length);
  const dims = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes]));
    return { width: bitmap.width, height: bitmap.height };
  }, on.sent!.toString('base64'));
  expect(dims.width).toBeLessThanOrEqual(100);
  expect(dims.height).toBe(Math.round((300 * dims.width) / 400));
});

test('a display URL that fails to load is resolved again; the stored asset: reference is unchanged', async ({
  page,
}) => {
  const ref = `asset:sha256:${'cd'.repeat(32)}`;
  const requested: string[] = [];
  await page.route('**/__asset/*.png', async (route) => {
    requested.push(new URL(route.request().url()).pathname);
    // The first signed URL has expired; the second one works.
    if (requested.length === 1) await route.fulfill({ status: 403, body: 'expired' });
    else await route.fulfill({ contentType: 'image/png', body: Buffer.from(PNG_B64, 'base64') });
  });
  await load(page, 'assets=flaky', `<img src="${ref}">`);
  const img = page.locator('[data-testid="editor-content"] img');
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true);
  expect(requested).toEqual(['/__asset/1.png', '/__asset/2.png']);
  expect(
    await page.evaluate(() => (window as never as { __rcmFlakyCalls: string[] }).__rcmFlakyCalls),
  ).toEqual([ref, ref]);
  expect(await imageSrcs(page)).toEqual([ref]);
});
