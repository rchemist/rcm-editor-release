import { vi } from 'vitest';

/** Minimal XMLHttpRequest double: records the request, the test answers it. */
export class FakeXhr {
  static instances: FakeXhr[] = [];
  method = '';
  url = '';
  headers: Record<string, string> = {};
  withCredentials = false;
  body: unknown = null;
  status = 0;
  responseText = '';
  aborted = false;
  upload: { onprogress: ((event: unknown) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXhr.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }
  respond(status: number, text = '') {
    this.status = status;
    this.responseText = text;
    this.onload?.();
  }
  fail() {
    this.onerror?.();
  }

  static install(): void {
    FakeXhr.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
  }
  static last(): FakeXhr {
    const x = FakeXhr.instances.at(-1);
    if (!x) throw new Error('no XHR was made');
    return x;
  }
}

export const imageFile = (name = 'a.png', size = 4, type = 'image/png'): File =>
  new File([new Uint8Array(size).fill(1)], name, { type });

export const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
