import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RcmUploadError,
  base64Uploader,
  httpUploader,
  presignedUploader,
  withPolicy,
} from '../../src/upload';
import type { RcmUploadContext } from '../../src/upload';
import { FakeXhr, imageFile, tick } from '../helpers/fakeXhr';

const ctx = (signal: AbortSignal = new AbortController().signal): RcmUploadContext => ({ signal });

beforeEach(() => FakeXhr.install());
afterEach(() => vi.unstubAllGlobals());

const rejection = async (promise: Promise<unknown>): Promise<RcmUploadError> => {
  try {
    await promise;
  } catch (error) {
    return error as RcmUploadError;
  }
  throw new Error('expected a rejection');
};

describe('base64Uploader', () => {
  it('resolves to a data URL of the file bytes', async () => {
    const result = await base64Uploader()(imageFile('a.png', 4), ctx());
    expect(result).toEqual({ src: 'data:image/png;base64,AQEBAQ==' });
  });

  it('a file over maxBytes is refused with code "size"', async () => {
    const error = await rejection(base64Uploader({ maxBytes: 3 })(imageFile('a.png', 4), ctx()));
    expect(error).toBeInstanceOf(RcmUploadError);
    expect(error.code).toBe('size');
  });

  it('the default limit is 2 MiB', async () => {
    const big = imageFile('big.png', 2 * 1024 * 1024 + 1);
    expect((await rejection(base64Uploader()(big, ctx()))).code).toBe('size');
  });

  it('a type outside accept is refused with code "type" (wildcards and exact types)', async () => {
    const pdf = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    expect((await rejection(base64Uploader()(pdf, ctx()))).code).toBe('type');
    const gif = imageFile('a.gif', 3, 'image/gif');
    expect((await rejection(base64Uploader({ accept: ['image/png'] })(gif, ctx()))).code).toBe(
      'type',
    );
    await expect(base64Uploader({ accept: ['image/*'] })(gif, ctx())).resolves.toBeTruthy();
    await expect(base64Uploader({ accept: ['.pdf'] })(pdf, ctx())).resolves.toBeTruthy();
  });

  it('SEC-6 maxBytes: undefined does not drop the 2 MiB default', async () => {
    const big = imageFile('big.png', 2 * 1024 * 1024 + 1);
    expect((await rejection(base64Uploader({ maxBytes: undefined })(big, ctx()))).code).toBe(
      'size',
    );
    expect(
      (await rejection(base64Uploader({ accept: ['image/png'], maxBytes: undefined })(big, ctx())))
        .code,
    ).toBe('size');
  });
});

describe('httpUploader', () => {
  it('sends multipart with the field name, fields first, headers and credentials; JSON url is the src', async () => {
    const upload = httpUploader({
      endpoint: '/api/assets',
      fieldName: 'upload',
      fields: { folder: 'notices' },
      headers: { 'X-Static': '1' },
      getHeaders: () => ({ Authorization: 'Bearer t' }),
      withCredentials: true,
    });
    const promise = upload(imageFile('a.png'), ctx());
    await tick();
    const xhr = FakeXhr.last();
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/api/assets');
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.headers).toEqual({ 'X-Static': '1', Authorization: 'Bearer t' });
    const form = xhr.body as FormData;
    expect([...form.keys()]).toEqual(['folder', 'upload']);
    expect((form.get('upload') as File).name).toBe('a.png');
    xhr.respond(200, JSON.stringify({ url: 'https://cdn.test/a.png' }));
    await expect(promise).resolves.toEqual({ src: 'https://cdn.test/a.png' });
  });

  it('the default mapResponse also reads "src"; mapResponse can return an asset: reference', async () => {
    const plain = httpUploader({ endpoint: '/u' })(imageFile(), ctx());
    await tick();
    FakeXhr.last().respond(201, JSON.stringify({ src: 'https://cdn.test/b.png' }));
    await expect(plain).resolves.toEqual({ src: 'https://cdn.test/b.png' });

    const mapped = httpUploader({
      endpoint: '/u',
      mapResponse: (body) => `asset:sha256:${(body as { sha: string }).sha}`,
    })(imageFile(), ctx());
    await tick();
    FakeXhr.last().respond(200, JSON.stringify({ sha: 'ab12' }));
    await expect(mapped).resolves.toEqual({ src: 'asset:sha256:ab12' });
  });

  it('a response without url/src is an "other" error', async () => {
    const promise = httpUploader({ endpoint: '/u' })(imageFile(), ctx());
    await tick();
    FakeXhr.last().respond(200, '{}');
    expect((await rejection(promise)).code).toBe('other');
  });

  it('a non-2xx response is code "http" with the status; a network failure is "network"', async () => {
    const http = httpUploader({ endpoint: '/u' })(imageFile(), ctx());
    await tick();
    FakeXhr.last().respond(413);
    const httpError = await rejection(http);
    expect(httpError.code).toBe('http');
    expect(httpError.status).toBe(413);

    const net = httpUploader({ endpoint: '/u' })(imageFile(), ctx());
    await tick();
    FakeXhr.last().fail();
    expect((await rejection(net)).code).toBe('network');
  });

  it('a refused file sends no request', async () => {
    const upload = httpUploader({ endpoint: '/u', accept: ['image/png'], maxBytes: 2 });
    expect((await rejection(upload(imageFile('a.png', 4), ctx()))).code).toBe('size');
    expect(
      (await rejection(upload(new File(['x'], 'a.txt', { type: 'text/plain' }), ctx()))).code,
    ).toBe('type');
    expect(FakeXhr.instances).toHaveLength(0);
  });

  it('progress is monotonic up to 1; abort cancels the request', async () => {
    const seen: number[] = [];
    const controller = new AbortController();
    const promise = httpUploader({ endpoint: '/u' })(imageFile(), {
      signal: controller.signal,
      onProgress: (f) => seen.push(f),
    });
    await tick();
    const xhr = FakeXhr.last();
    xhr.progress(10, 100);
    xhr.progress(5, 100); // regress: ignored
    xhr.progress(60, 100);
    controller.abort();
    expect((await rejection(promise)).code).toBe('abort');
    expect(xhr.aborted).toBe(true);
    expect(seen).toEqual([0.1, 0.6]);

    const done: number[] = [];
    const ok = httpUploader({ endpoint: '/u' })(imageFile(), {
      signal: new AbortController().signal,
      onProgress: (f) => done.push(f),
    });
    await tick();
    FakeXhr.last().progress(50, 100);
    FakeXhr.last().respond(200, '{"url":"x"}');
    await ok;
    expect(done).toEqual([0.5, 1]);
  });
});

describe('presignedUploader', () => {
  it('PUTs the file as the body to the presigned URL with its headers, then returns the callback src', async () => {
    const presign = vi.fn(() => ({
      url: 'https://bucket.test/k?sig=1',
      method: 'PUT' as const,
      headers: { 'Content-Type': 'image/png' },
      src: 'https://cdn.test/k.png',
    }));
    const file = imageFile('a.png');
    const promise = presignedUploader({ presign })(file, ctx());
    await tick();
    const xhr = FakeXhr.last();
    expect(presign).toHaveBeenCalledWith(file);
    expect(xhr.method).toBe('PUT');
    expect(xhr.url).toBe('https://bucket.test/k?sig=1');
    expect(xhr.headers).toEqual({ 'Content-Type': 'image/png' });
    expect(xhr.body).toBe(file);
    xhr.respond(200);
    await expect(promise).resolves.toEqual({ src: 'https://cdn.test/k.png' });
  });

  it('POST sends a form with the policy fields in order and the file last', async () => {
    const promise = presignedUploader({
      presign: () => ({
        url: 'https://bucket.test/',
        method: 'POST',
        fields: { key: 'k', policy: 'p', 'x-amz-signature': 's' },
        src: 'asset:sha256:cd',
      }),
    })(imageFile('a.png'), ctx());
    await tick();
    const xhr = FakeXhr.last();
    expect(xhr.method).toBe('POST');
    const form = xhr.body as FormData;
    expect([...form.keys()]).toEqual(['key', 'policy', 'x-amz-signature', 'file']);
    xhr.respond(204);
    await expect(promise).resolves.toEqual({ src: 'asset:sha256:cd' });
  });

  it('a refused file never reaches presign', async () => {
    const presign = vi.fn();
    const upload = presignedUploader({ presign, maxBytes: 1 });
    expect((await rejection(upload(imageFile('a.png', 4), ctx()))).code).toBe('size');
    expect(presign).not.toHaveBeenCalled();
  });

  it('an upload to the presigned URL that fails is "http"', async () => {
    const promise = presignedUploader({
      presign: () => ({ url: 'https://b.test/', method: 'PUT', src: 'x' }),
    })(imageFile(), ctx());
    await tick();
    FakeXhr.last().respond(403);
    const error = await rejection(promise);
    expect(error.code).toBe('http');
    expect(error.status).toBe(403);
  });
});

describe('withPolicy', () => {
  it('wraps a user function with the same validation; its string result passes through', async () => {
    const fn = vi.fn(async () => 'https://cdn.test/u.png');
    const wrapped = withPolicy(fn, { accept: ['image/*'], maxBytes: 8 });
    await expect(wrapped(imageFile('a.png', 4), ctx())).resolves.toBe('https://cdn.test/u.png');
    expect((await rejection(wrapped(imageFile('a.png', 9), ctx()))).code).toBe('size');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('SEC-6 resize input cap', () => {
  it('SEC-6 with resize a huge original is refused before createImageBitmap decodes it', async () => {
    // jsdom cannot decode images: every decode throws, so `decode` not being called proves the
    // pre-decode cap fired (a file under the cap does reach the decoder).
    const decode = vi.fn(async () => {
      throw new Error('no decode');
    });
    vi.stubGlobal('createImageBitmap', decode);
    const fakeSize = (file: File, size: number) =>
      Object.defineProperty(file, 'size', { value: size });

    // maxBytes set: the cap is maxBytes * 10.
    const limited = withPolicy(async () => 'x', { resize: { maxWidth: 100 }, maxBytes: 100 });
    const over = fakeSize(imageFile('over.png', 4), 1001);
    expect((await rejection(limited(over, ctx()))).code).toBe('size');
    expect(decode).not.toHaveBeenCalled();
    const under = imageFile('under.png', 4);
    await expect(limited(under, ctx())).resolves.toBe('x');
    expect(decode).toHaveBeenCalledTimes(1);

    // no maxBytes: the 50 MiB default cap.
    const unlimited = withPolicy(async () => 'x', { resize: { maxWidth: 100 } });
    const huge = fakeSize(imageFile('huge.png', 4), 50 * 1024 * 1024 + 1);
    expect((await rejection(unlimited(huge, ctx()))).code).toBe('size');
    expect(decode).toHaveBeenCalledTimes(1); // only the "under" file ever reached the decoder
  });
});
