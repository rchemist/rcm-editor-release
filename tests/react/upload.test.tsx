import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { RcmEditor, TOOLBAR_PRESETS } from '../../src/react';
import type { RcmEditorProps, RcmUploadError } from '../../src/react';
import { resetDevWarnings } from '../../src/react/devWarnings';
import { imageFile } from '../helpers/fakeXhr';

const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = emptyRects;
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
}

beforeEach(() => {
  resetDevWarnings();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function mount(props: RcmEditorProps = {}) {
  let editor: Editor | undefined;
  const utils = render(<RcmEditor {...props} onReady={(e) => (editor = e)} />);
  await waitFor(() => expect(editor).toBeDefined());
  const q = (id: string) => utils.container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  return { ...utils, editor: editor as Editor, q };
}

const srcs = (editor: Editor) =>
  (editor.getJSON().content ?? []).filter((n) => n.type === 'image').map((n) => n.attrs?.src);

describe('upload props and toolbar', () => {
  it('the insert group right before link is image, file (+ youtube in full)', () => {
    for (const preset of ['full', 'simple'] as const) {
      const list = TOOLBAR_PRESETS[preset];
      const at = list.indexOf('link');
      const group = preset === 'full' ? ['image', 'file', 'youtube'] : ['image', 'file'];
      expect(list.slice(at - group.length, at)).toEqual(group);
    }
  });

  it('the file item needs a configured file uploader: omitted without uploadFile, shown with it', async () => {
    const plain = await mount();
    expect(plain.q('rcm-tb-file')).toBeNull();
    expect(plain.q('rcm-tbo-file-input')).toBeNull();
    cleanup();
    const withUploader = await mount({ uploadFile: async () => 'https://cdn.test/a.pdf' });
    expect(withUploader.q('rcm-tb-file')).not.toBeNull();
    expect(withUploader.q('rcm-tbo-file-input')).not.toBeNull();
  });

  it('a uploadFile prop added after mount shows the file item (the toolbar re-resolves)', async () => {
    const t = await mount();
    expect(t.q('rcm-tb-file')).toBeNull();
    t.rerender(<RcmEditor uploadFile={async () => 'https://cdn.test/a.pdf'} onReady={() => {}} />);
    await waitFor(() => expect(t.q('rcm-tb-file')).not.toBeNull());
  });

  it('choosing a file through rcm-tbo-file-input calls uploadFile and inserts a link with the file name', async () => {
    const uploadFile = vi.fn(async () => 'https://cdn.test/report.pdf');
    const t = await mount({ uploadFile });
    const input = t.q('rcm-tbo-file-input') as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.hasAttribute('accept')).toBe(false);
    await act(
      async () =>
        void fireEvent.change(input, {
          target: { files: [imageFile('report.pdf', 16, 'application/pdf')] },
        }),
    );
    await waitFor(() => expect(t.editor.getHTML()).toContain('href="https://cdn.test/report.pdf"'));
    expect(t.editor.getText()).toContain('report.pdf');
    expect(uploadFile).toHaveBeenCalledTimes(1);
  });

  it('the toolbar file input runs uploadImage once per file and inserts the result', async () => {
    const uploadImage = vi.fn(async () => 'https://cdn.test/t.png');
    const t = await mount({ uploadImage });
    const input = t.q('rcm-tbo-image-input') as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.accept).toBe('image/*');
    expect(t.q('rcm-tb-image')).not.toBeNull();
    await act(
      async () => void fireEvent.change(input, { target: { files: [imageFile('t.png')] } }),
    );
    await waitFor(() => expect(srcs(t.editor)).toEqual(['https://cdn.test/t.png']));
    expect(uploadImage).toHaveBeenCalledTimes(1);
  });

  it('without uploadImage the toolbar path stores a base64 data URL', async () => {
    const t = await mount();
    const input = t.q('rcm-tbo-image-input') as HTMLInputElement;
    await act(
      async () => void fireEvent.change(input, { target: { files: [imageFile('t.png')] } }),
    );
    await waitFor(() => expect(srcs(t.editor)).toEqual(['data:image/png;base64,AQEBAQ==']));
  });

  it('onUploadError gets the RcmUploadError and the file; the widget labels come from labels', async () => {
    const onUploadError = vi.fn();
    const t = await mount({
      uploadImage: async () => {
        throw new Error('x');
      },
      onUploadError,
      labels: { uploadFailed: 'LBL_FAILED', uploadRetry: 'LBL_RETRY' },
    });
    act(() => void t.editor.commands.uploadFiles([imageFile('f.png')]));
    await waitFor(() => expect(t.q('rcm-upload-error')).not.toBeNull());
    expect(t.q('rcm-upload-error')?.getAttribute('aria-label')).toBe('LBL_FAILED');
    expect(t.q('rcm-upload-retry')?.getAttribute('aria-label')).toBe('LBL_RETRY');
    const [error, file] = onUploadError.mock.calls[0] as [RcmUploadError, File];
    expect(error.code).toBe('other');
    expect(file.name).toBe('f.png');
  });

  it('the latest uploadImage prop is used', async () => {
    const first = vi.fn(async () => 'https://cdn.test/1.png');
    const second = vi.fn(async () => 'https://cdn.test/2.png');
    const t = await mount({ uploadImage: first });
    t.rerender(<RcmEditor uploadImage={second} onReady={() => {}} />);
    act(() => void t.editor.commands.uploadFiles([imageFile('a.png')]));
    await waitFor(() => expect(srcs(t.editor)).toEqual(['https://cdn.test/2.png']));
    expect(first).not.toHaveBeenCalled();
  });

  it('features.upload: false drops the pipeline and the toolbar image item', async () => {
    const t = await mount({ features: { upload: false } });
    expect(t.q('rcm-tb-image')).toBeNull();
    expect('uploadFiles' in t.editor.commands).toBe(false);
  });
});
