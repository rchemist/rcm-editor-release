import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor, JSONContent } from '@tiptap/core';
import { RcmUploadError } from '../../src/upload';
import type { RcmUploadContext, RcmUploader } from '../../src/upload';
import { UPLOAD_PLUGIN_KEY, getLosslessJSON } from '../../src/index';
import { destroyEditors, makeEditor } from '../helpers/editor';
import { imageFile } from '../helpers/fakeXhr';

afterEach(destroyEditors);

const q = (editor: Editor, id: string) =>
  editor.view.dom.querySelector<HTMLElement>(`[data-testid="${id}"]`);

const imageSrcs = (editor: Editor): string[] => {
  const out: string[] = [];
  const walk = (node: JSONContent) => {
    if (node.type === 'image' || node.type === 'inlineImage') out.push(String(node.attrs?.src));
    node.content?.forEach(walk);
  };
  walk(editor.getJSON());
  return out;
};

interface Deferred {
  ctx: RcmUploadContext;
  resolve: (v: string | { src: string; name?: string }) => void;
  reject: (e: unknown) => void;
}

/** An uploader whose calls the test settles by hand. */
function manual(): { uploader: RcmUploader; calls: Deferred[] } {
  const calls: Deferred[] = [];
  const uploader: RcmUploader = (_file, ctx) =>
    new Promise((resolve, reject) => calls.push({ ctx, resolve, reject }));
  return { uploader, calls };
}

function setup(
  upload: Parameters<typeof makeEditor>[1] extends infer O
    ? O extends { features?: { upload?: infer U } }
      ? U
      : never
    : never,
  content = '<p>hello</p>',
): Editor {
  return makeEditor(content, { features: { upload } });
}

describe('upload pipeline', () => {
  it('without an uploader an image becomes a base64 data URL image', async () => {
    const editor = setup({});
    expect(editor.commands.uploadFiles([imageFile('a.png', 4)])).toBe(true);
    await editor.storage.upload.whenSettled();
    expect(imageSrcs(editor)).toEqual(['data:image/png;base64,AQEBAQ==']);
    expect(q(editor, 'rcm-upload-placeholder')).toBeNull();
  });

  it('a file over the default base64 limit is not inserted and shows the error state', async () => {
    const onUploadError = vi.fn();
    const editor = setup({ onUploadError });
    const before = JSON.stringify(editor.getJSON());
    editor.commands.uploadFiles([imageFile('big.png', 2 * 1024 * 1024 + 1)]);
    await editor.storage.upload.whenSettled();
    expect(JSON.stringify(editor.getJSON())).toBe(before);
    expect(q(editor, 'rcm-upload-error')).not.toBeNull();
    expect(onUploadError).toHaveBeenCalledTimes(1);
    const [error, file] = onUploadError.mock.calls[0] as [RcmUploadError, File];
    expect(error).toBeInstanceOf(RcmUploadError);
    expect(error.code).toBe('size');
    expect(file.name).toBe('big.png');
  });

  it('a user function result (string or {src}) is the image src', async () => {
    const editor = setup({
      uploadImage: async (file) =>
        file.name === 'a.png' ? 'https://cdn.test/a.png' : { src: 'asset:sha256:ab' },
    });
    editor.commands.uploadFiles([imageFile('a.png'), imageFile('b.png')]);
    await editor.storage.upload.whenSettled();
    expect(imageSrcs(editor).sort()).toEqual(['asset:sha256:ab', 'https://cdn.test/a.png']);
  });

  it('while uploading there is a placeholder decoration and no node in JSON/HTML', async () => {
    const { uploader, calls } = manual();
    const editor = setup({ uploadImage: uploader });
    const json = JSON.stringify(editor.getJSON());
    const html = editor.getHTML();
    editor.commands.uploadFiles([imageFile('a.png')]);
    await Promise.resolve();
    const placeholder = q(editor, 'rcm-upload-placeholder');
    expect(placeholder).not.toBeNull();
    expect(placeholder?.getAttribute('aria-busy')).toBe('true');
    expect(placeholder?.getAttribute('data-progress')).toBe('0');
    expect(JSON.stringify(editor.getJSON())).toBe(json);
    expect(JSON.stringify(getLosslessJSON(editor))).toBe(JSON.stringify(getLosslessJSON(editor)));
    expect(editor.getHTML()).toBe(html);

    calls[0]!.ctx.onProgress?.(0.3);
    calls[0]!.ctx.onProgress?.(0.2); // not monotonic: ignored
    calls[0]!.ctx.onProgress?.(0.7);
    expect(q(editor, 'rcm-upload-placeholder')?.getAttribute('data-progress')).toBe('0.7');
    expect(JSON.stringify(editor.getJSON())).toBe(json);

    calls[0]!.resolve('https://cdn.test/a.png');
    await editor.storage.upload.whenSettled();
    expect(q(editor, 'rcm-upload-placeholder')).toBeNull();
    expect(imageSrcs(editor)).toEqual(['https://cdn.test/a.png']);
  });

  it('dismissing the placeholder aborts the request and inserts nothing', async () => {
    const { uploader, calls } = manual();
    const editor = setup({ uploadImage: uploader });
    editor.commands.uploadFiles([imageFile('a.png')]);
    await Promise.resolve();
    q(editor, 'rcm-upload-dismiss')!.click();
    expect(calls[0]!.ctx.signal.aborted).toBe(true);
    expect(q(editor, 'rcm-upload-placeholder')).toBeNull();
    calls[0]!.resolve('https://cdn.test/late.png');
    await editor.storage.upload.whenSettled();
    expect(imageSrcs(editor)).toEqual([]);
  });

  it('destroying the editor aborts in-flight uploads', async () => {
    const { uploader, calls } = manual();
    const editor = setup({ uploadImage: uploader });
    editor.commands.uploadFiles([imageFile('a.png')]);
    await Promise.resolve();
    editor.destroy();
    expect(calls[0]!.ctx.signal.aborted).toBe(true);
  });

  it('a failed upload leaves the document unchanged, shows error + retry + dismiss, and retry can succeed', async () => {
    let attempt = 0;
    const onUploadError = vi.fn();
    const editor = setup({
      uploadImage: async () => {
        if (++attempt === 1) throw new RcmUploadError('http', 'boom', { status: 500 });
        return 'https://cdn.test/ok.png';
      },
      onUploadError,
    });
    const before = JSON.stringify(editor.getJSON());
    editor.commands.uploadFiles([imageFile('a.png')]);
    await editor.storage.upload.whenSettled();
    expect(JSON.stringify(editor.getJSON())).toBe(before);
    expect(q(editor, 'rcm-upload-error')?.getAttribute('data-error-code')).toBe('http');
    expect(q(editor, 'rcm-upload-retry')).not.toBeNull();
    expect(q(editor, 'rcm-upload-dismiss')).not.toBeNull();
    expect(onUploadError).toHaveBeenCalledTimes(1);

    q(editor, 'rcm-upload-retry')!.click();
    expect(q(editor, 'rcm-upload-placeholder')).not.toBeNull();
    await editor.storage.upload.whenSettled();
    expect(imageSrcs(editor)).toEqual(['https://cdn.test/ok.png']);
    expect(q(editor, 'rcm-upload-error')).toBeNull();
  });

  it('a plain Error from a user function is reported as code "other"', async () => {
    const onUploadError = vi.fn();
    const editor = setup({
      uploadImage: async () => {
        throw new Error('nope');
      },
      onUploadError,
    });
    editor.commands.uploadFiles([imageFile('a.png')]);
    await editor.storage.upload.whenSettled();
    expect((onUploadError.mock.calls[0]![0] as RcmUploadError).code).toBe('other');
    q(editor, 'rcm-upload-dismiss')!.click();
    expect(q(editor, 'rcm-upload-error')).toBeNull();
  });

  it('the image lands at the placeholder position after later edits', async () => {
    const { uploader, calls } = manual();
    const editor = setup({ uploadImage: uploader }, '<p>one</p><p>two</p>');
    // end of the second paragraph
    editor.commands.uploadFiles([imageFile('a.png')], { at: editor.state.doc.content.size - 1 });
    await Promise.resolve();
    editor.commands.insertContentAt(1, 'XYZ'); // before the placeholder
    calls[0]!.resolve('https://cdn.test/a.png');
    await editor.storage.upload.whenSettled();
    const content = (editor.getJSON().content ?? []).map((n) => n.type);
    expect(content.filter((t) => t === 'image')).toHaveLength(1);
    const html = editor.getHTML();
    expect(html.indexOf('XYZone')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('two')).toBeLessThan(html.indexOf('<img'));
  });

  it('deleting the content around a placeholder cancels it', async () => {
    const { uploader, calls } = manual();
    const editor = setup({ uploadImage: uploader });
    editor.commands.uploadFiles([imageFile('a.png')], { at: 3 });
    await Promise.resolve();
    editor.commands.setContent('<p>replaced</p>');
    await Promise.resolve();
    expect(calls[0]!.ctx.signal.aborted).toBe(true);
    expect(q(editor, 'rcm-upload-placeholder')).toBeNull();
    calls[0]!.resolve('https://cdn.test/a.png');
    await editor.storage.upload.whenSettled();
    expect(imageSrcs(editor)).toEqual([]);
  });

  it('non-image files become a link with the name only when uploadFile exists', async () => {
    const pdf = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    const without = setup({ uploadImage: async () => 'x' });
    expect(without.commands.uploadFiles([pdf])).toBe(false);
    expect(q(without, 'rcm-upload-placeholder')).toBeNull();

    const uploadFile = vi.fn(async () => ({ src: 'https://cdn.test/doc.pdf' }));
    const editor = setup({ uploadFile });
    editor.commands.uploadFiles([pdf], { at: 6 });
    await editor.storage.upload.whenSettled();
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(editor.getHTML()).toContain('<a href="https://cdn.test/doc.pdf"');
    expect(editor.getHTML()).toContain('>doc.pdf</a>');
    expect(imageSrcs(editor)).toEqual([]);
  });

  it('a pasted image file runs the pipeline once; text next to the file is pasted as text instead', async () => {
    const uploadImage = vi.fn(async () => 'https://cdn.test/p.png');
    const editor = setup({ uploadImage });
    const paste = (data: { files: File[]; html?: string; text?: string }) => {
      const event = {
        clipboardData: {
          files: data.files,
          getData: (type: string) => (type === 'text/html' ? (data.html ?? '') : (data.text ?? '')),
        },
        preventDefault: vi.fn(),
      } as unknown as ClipboardEvent;
      // Only the upload plugin's handler: other plugins (code block) parse the clipboard text.
      const plugin = UPLOAD_PLUGIN_KEY.get(editor.state)!;
      return plugin.props.handlePaste!.call(plugin, editor.view, event, null as never) ?? false;
    };
    expect(paste({ files: [imageFile('s.png')] })).toBe(true);
    await editor.storage.upload.whenSettled();
    expect(uploadImage).toHaveBeenCalledTimes(1);
    expect(imageSrcs(editor)).toHaveLength(1);

    expect(
      paste({ files: [imageFile('x.png')], html: '<table><tr><td>cell</td></tr></table>' }),
    ).toBe(false);
    expect(paste({ files: [imageFile('y.png')], text: 'copied text' })).toBe(false);
    // copying an image from a web page: html carries only the <img>
    expect(paste({ files: [imageFile('z.png')], html: '<img src="https://x.test/z.png">' })).toBe(
      true,
    );
    await editor.storage.upload.whenSettled();
    expect(uploadImage).toHaveBeenCalledTimes(2);
  });

  it('features.upload: false removes the command and the pipeline', () => {
    const editor = makeEditor('<p>x</p>', { features: { upload: false } });
    expect('uploadFiles' in editor.commands).toBe(false);
  });

  it('handlers are read at call time (latest props)', async () => {
    let current: RcmUploader = async () => 'https://cdn.test/one.png';
    const editor = setup({ handlers: () => ({ uploadImage: current }) });
    editor.commands.uploadFiles([imageFile('a.png')]);
    await editor.storage.upload.whenSettled();
    current = async () => 'https://cdn.test/two.png';
    editor.commands.uploadFiles([imageFile('b.png')]);
    await editor.storage.upload.whenSettled();
    expect(imageSrcs(editor).sort()).toEqual([
      'https://cdn.test/one.png',
      'https://cdn.test/two.png',
    ]);
  });

  it('widget texts come from the labels option', async () => {
    const { uploader } = manual();
    const editor = setup({
      uploadImage: uploader,
      labels: { uploading: 'LBL_UP', dismiss: 'LBL_X' },
    });
    editor.commands.uploadFiles([imageFile('a.png')]);
    await Promise.resolve();
    expect(q(editor, 'rcm-upload-placeholder')?.getAttribute('aria-label')).toBe('LBL_UP');
    expect(q(editor, 'rcm-upload-dismiss')?.getAttribute('aria-label')).toBe('LBL_X');
  });

  it('several files at one position (even an empty paragraph) all land, none replaces another', async () => {
    let n = 0;
    const editor = setup({ uploadImage: async () => `https://cdn.test/${n++}.png` }, '<p></p>');
    editor.commands.uploadFiles([imageFile('a.png'), imageFile('b.png'), imageFile('c.png')], {
      at: 1,
    });
    await editor.storage.upload.whenSettled();
    expect(imageSrcs(editor)).toEqual([
      'https://cdn.test/0.png',
      'https://cdn.test/1.png',
      'https://cdn.test/2.png',
    ]);
  });

  it('an image dropped in the middle of a paragraph splits it; no text is lost', async () => {
    const editor = setup({ uploadImage: async () => 'https://cdn.test/m.png' }, '<p>abcdef</p>');
    editor.commands.uploadFiles([imageFile('a.png')], { at: 4 });
    await editor.storage.upload.whenSettled();
    expect(editor.getHTML()).toBe('<p>abc</p><img src="https://cdn.test/m.png"><p>def</p>');
  });
});
