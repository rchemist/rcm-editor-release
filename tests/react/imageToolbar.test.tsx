import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { Editor, JSONContent } from '@tiptap/core';
import { DEFAULT_EDITOR_LABELS, RcmEditor } from '../../src/react';
import type { RcmEditorProps } from '../../src/react';
import { destroyEditors, makeEditor } from '../helpers/editor';
import { diffDocs, formatDifferences } from '../helpers/json-equal';
import { resetDevWarnings } from '../../src/react/devWarnings';

// jsdom has no layout: ProseMirror's scroll/coords helpers need these.
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
  destroyEditors();
  vi.restoreAllMocks();
});

const SRC = 'https://example.test/a.png';

const imagePosOf = (editor: Editor, type = 'image'): number => {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === type) found = pos;
  });
  if (found < 0) throw new Error(`no ${type} in doc`);
  return found;
};

const attrsOf = (editor: Editor, type = 'image'): Record<string, unknown> => {
  let attrs: Record<string, unknown> = {};
  editor.state.doc.descendants((node) => {
    if (node.type.name === type) attrs = node.attrs as Record<string, unknown>;
  });
  return attrs;
};

describe('image commands', () => {
  it('setImageAlign sets block alignments; other values and null remove the attribute', () => {
    const editor = makeEditor(`<p>a</p><img src="${SRC}" width="200" height="100"><p>b</p>`);
    act(() => void editor.commands.setNodeSelection(imagePosOf(editor)));
    for (const align of ['left', 'center', 'right', 'inline'] as const) {
      expect(editor.commands.setImageAlign(align)).toBe(true);
      expect(attrsOf(editor).align).toBe(align);
    }
    expect(editor.getHTML()).toContain('data-align="inline"');
    expect(editor.commands.setImageAlign(null)).toBe(true);
    expect(attrsOf(editor).align).toBeNull();
    expect(editor.getHTML()).not.toContain('data-align');
    const setAlign = editor.commands.setImageAlign as (a: unknown) => boolean;
    expect(setAlign('bogus')).toBe(true);
    expect(attrsOf(editor).align).toBeNull();
  });

  it('setImageAlign on inlineImage allows left/right only; the rest removes the attribute', () => {
    const editor = makeEditor(`<p>a<img src="${SRC}" alt="x">b</p>`);
    // An attribute write maps the inline NodeSelection to a cursor: re-select each time.
    const align = (value: 'left' | 'center' | 'inline' | null) => {
      act(() => void editor.commands.setNodeSelection(imagePosOf(editor, 'inlineImage')));
      return editor.commands.setImageAlign(value);
    };
    expect(align('left')).toBe(true);
    expect(attrsOf(editor, 'inlineImage').align).toBe('left');
    expect(editor.getHTML()).toContain('float: left');
    expect(align('center')).toBe(true);
    expect(attrsOf(editor, 'inlineImage').align).toBeNull();
    expect(align('inline')).toBe(true);
    expect(attrsOf(editor, 'inlineImage').align).toBeNull();
    expect(align(null)).toBe(true);
    expect(attrsOf(editor, 'inlineImage').align).toBeNull();
  });

  it('setImageAlign is false without an image selection; a figure caption selection targets the inner image', () => {
    const editor = makeEditor('<p>abc</p>');
    act(() => void editor.commands.setTextSelection(2));
    expect(editor.commands.setImageAlign('left')).toBe(false);

    const captioned = makeEditor(`<img src="${SRC}" width="200" height="100">`);
    act(() => void captioned.commands.setNodeSelection(imagePosOf(captioned)));
    expect(captioned.commands.toggleImageCaption()).toBe(true);
    // The cursor is in the caption: aligning still targets the figure's image.
    expect(captioned.commands.setImageAlign('right')).toBe(true);
    expect(attrsOf(captioned).align).toBe('right');
  });

  it('setImageAlt sets the attribute; an empty string removes it', () => {
    const editor = makeEditor(`<p>a</p><img src="${SRC}"><p>b</p>`);
    act(() => void editor.commands.setNodeSelection(imagePosOf(editor)));
    expect(editor.commands.setImageAlt('그림 설명')).toBe(true);
    expect(attrsOf(editor).alt).toBe('그림 설명');
    expect(editor.getHTML()).toContain('alt="그림 설명"');
    expect(editor.commands.setImageAlt('')).toBe(true);
    expect(attrsOf(editor).alt).toBeNull();
    expect(editor.getHTML()).not.toContain('alt=');
  });

  it('setImageSize rounds to px integers and rejects invalid sizes', () => {
    const editor = makeEditor(`<p>a</p><img src="${SRC}"><p>b</p>`);
    act(() => void editor.commands.setNodeSelection(imagePosOf(editor)));
    expect(editor.commands.setImageSize({ width: 200.6, height: 100.4 })).toBe(true);
    expect(attrsOf(editor)).toMatchObject({ width: 201, height: 100 });
    expect(editor.getHTML()).toContain('width="201"');
    for (const size of [
      { width: 0, height: 10 },
      { width: -5, height: 10 },
      { width: Number.NaN, height: 10 },
      { width: Number.POSITIVE_INFINITY, height: 10 },
    ]) {
      expect(editor.commands.setImageSize(size)).toBe(false);
    }
    expect(attrsOf(editor)).toMatchObject({ width: 201, height: 100 });
    const bare = makeEditor('<p>abc</p>');
    act(() => void bare.commands.setTextSelection(2));
    expect(bare.commands.setImageSize({ width: 10, height: 10 })).toBe(false);
  });
});

describe('caption toggle', () => {
  it('toggle wraps the image in figure/figcaption and back to the original JSON', () => {
    const editor = makeEditor(
      `<p>a</p><img src="${SRC}" alt="x" width="200" height="100"><p>b</p>`,
    );
    const before = editor.getJSON() as JSONContent;
    act(() => void editor.commands.setNodeSelection(imagePosOf(editor)));
    expect(editor.commands.toggleImageCaption()).toBe(true);
    const wrapped = editor.getJSON().content ?? [];
    expect(wrapped[1]?.type).toBe('figure');
    expect((wrapped[1]?.content ?? []).map((n) => n.type)).toEqual(['image', 'figcaption']);
    // The cursor is in the empty caption: toggling unwraps to the bare image again.
    expect(editor.commands.toggleImageCaption()).toBe(true);
    const after = editor.getJSON() as JSONContent;
    const diffs = diffDocs(before, after);
    expect(diffs, formatDifferences(diffs)).toEqual([]);
  });
});

async function mount(props: RcmEditorProps = {}) {
  let editor: Editor | undefined;
  const utils = render(<RcmEditor {...props} onReady={(e) => (editor = e)} />);
  await waitFor(() => expect(editor).toBeDefined());
  const ed = editor as Editor;
  const q = (id: string) => utils.container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const must = (id: string) => {
    const el = q(id);
    if (!el) throw new Error(`missing ${id}`);
    return el;
  };
  const selectImage = (type = 'image') =>
    act(() => void ed.commands.setNodeSelection(imagePosOf(ed, type)));
  return { ...utils, editor: ed, q, must, selectImage };
}

const BLOCK = `<p>a</p><img src="${SRC}" alt="old" width="200" height="100"><p>b</p>`;
const INLINE = `<p>a<img src="${SRC}" alt="old">b</p>`;

describe('image bar mount rules and buttons', () => {
  it('no image selection shows no bar; selecting shows the bar with handles', async () => {
    const t = await mount({ defaultValue: BLOCK });
    expect(t.q('rcm-image-bar')).toBeNull();
    expect(t.q('rcm-image-handle')).toBeNull();
    t.selectImage();
    await waitFor(() => expect(t.q('rcm-image-bar')).not.toBeNull());
    expect(t.must('rcm-image-bar')).toHaveAttribute('role', 'toolbar');
    const handles = Array.from(
      t.container.querySelectorAll<HTMLElement>('[data-testid="rcm-image-handle"]'),
    );
    expect(handles.map((h) => h.dataset.corner).sort()).toEqual(['ne', 'nw', 'se', 'sw']);
    for (const h of handles) {
      // Pointer-drag handles are aria-hidden; the injectable label lives on `title`.
      expect(h.getAttribute('aria-hidden')).toBe('true');
      expect(h.getAttribute('title')).toBe(DEFAULT_EDITOR_LABELS.ibResizeHandle);
    }
  });

  it('block align buttons set the attribute and aria-pressed; caption toggles the figure', async () => {
    const t = await mount({ defaultValue: BLOCK });
    t.selectImage();
    await waitFor(() => expect(t.q('rcm-image-bar')).not.toBeNull());
    for (const value of ['left', 'center', 'right', 'inline'] as const) {
      act(() => void fireEvent.click(t.must(`rcm-ib-align-${value}`)));
      expect(attrsOf(t.editor).align).toBe(value);
      await waitFor(() =>
        expect(t.must(`rcm-ib-align-${value}`)).toHaveAttribute('aria-pressed', 'true'),
      );
    }
    expect(t.q('rcm-ib-caption')).not.toBeNull();
    expect(t.must('rcm-ib-caption')).toHaveAttribute('aria-pressed', 'false');
    act(() => void fireEvent.click(t.must('rcm-ib-caption')));
    expect(t.editor.getJSON().content?.[1]?.type).toBe('figure');
    await waitFor(() => expect(t.must('rcm-ib-caption')).toHaveAttribute('aria-pressed', 'true'));
  });

  it('inline images show left/right/inline only and no caption', async () => {
    const t = await mount({ defaultValue: INLINE });
    t.selectImage('inlineImage');
    await waitFor(() => expect(t.q('rcm-image-bar')).not.toBeNull());
    expect(t.q('rcm-ib-align-left')).not.toBeNull();
    expect(t.q('rcm-ib-align-right')).not.toBeNull();
    expect(t.q('rcm-ib-align-inline')).not.toBeNull();
    expect(t.q('rcm-ib-align-center')).toBeNull();
    expect(t.q('rcm-ib-caption')).toBeNull();
    act(() => void fireEvent.click(t.must('rcm-ib-align-left')));
    expect(attrsOf(t.editor, 'inlineImage').align).toBe('left');
  });

  it('readonly and imageToolbar={false} never show the bar', async () => {
    const ro = await mount({ defaultValue: BLOCK, readonly: true });
    act(() => {
      // readonly locks document commands, not selection: select directly.
      ro.editor.commands.setNodeSelection(imagePosOf(ro.editor));
    });
    await waitFor(() => expect(ro.editor).toBeDefined());
    expect(ro.q('rcm-image-bar')).toBeNull();
    cleanup();

    const off = await mount({ defaultValue: BLOCK, imageToolbar: false });
    off.selectImage();
    await waitFor(() => expect(off.editor).toBeDefined());
    expect(off.q('rcm-image-bar')).toBeNull();
    expect(off.q('rcm-image-handle')).toBeNull();
  });

  it('injected labels name the bar, its buttons and the handles', async () => {
    const labels = Object.fromEntries(
      Object.keys(DEFAULT_EDITOR_LABELS).map((k) => [k, `SENT_${k}`]),
    );
    const t = await mount({ defaultValue: BLOCK, labels });
    t.selectImage();
    await waitFor(() => expect(t.q('rcm-image-bar')).not.toBeNull());
    expect(t.must('rcm-image-bar')).toHaveAttribute('aria-label', 'SENT_imageBar');
    expect(t.must('rcm-ib-align-left')).toHaveAttribute('aria-label', 'SENT_ibAlignLeft');
    expect(t.must('rcm-ib-caption')).toHaveAttribute('aria-label', 'SENT_ibCaption');
    expect(t.must('rcm-ib-alt')).toHaveAttribute('aria-label', 'SENT_ibAlt');
    for (const h of Array.from(
      t.container.querySelectorAll<HTMLElement>('[data-testid="rcm-image-handle"]'),
    )) {
      expect(h.getAttribute('title')).toBe('SENT_ibResizeHandle');
    }
  });
});

describe('image bar alt popover and keyboard', () => {
  it('alt popover applies on submit and cancels on Esc, focus returns to the editor', async () => {
    const t = await mount({ defaultValue: BLOCK });
    t.selectImage();
    await waitFor(() => expect(t.q('rcm-image-bar')).not.toBeNull());
    act(() => void fireEvent.click(t.must('rcm-ib-alt')));
    const input = t.must('rcm-ibo-alt-input') as HTMLInputElement;
    expect(input.value).toBe('old');
    expect(document.activeElement).toBe(input);
    act(() => void fireEvent.change(input, { target: { value: '새 설명' } }));
    const form = input.closest('form') as HTMLFormElement;
    act(() => void fireEvent.submit(form));
    expect(attrsOf(t.editor).alt).toBe('새 설명');
    expect(t.q('rcm-ibo-alt-input')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(t.editor.view.dom));

    act(() => void fireEvent.click(t.must('rcm-ib-alt')));
    const reopened = t.must('rcm-ibo-alt-input') as HTMLInputElement;
    expect(reopened.value).toBe('새 설명');
    act(() => void fireEvent.change(reopened, { target: { value: '취소됨' } }));
    act(() => void fireEvent.keyDown(reopened, { key: 'Escape' }));
    expect(attrsOf(t.editor).alt).toBe('새 설명');
    expect(t.q('rcm-ibo-alt-input')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(t.editor.view.dom));
  });

  it('roving arrows move between bar buttons; Esc on the bar refocuses the editor', async () => {
    const t = await mount({ defaultValue: BLOCK });
    t.selectImage();
    await waitFor(() => expect(t.q('rcm-image-bar')).not.toBeNull());
    const buttons = () => Array.from(t.container.querySelectorAll<HTMLElement>('[data-rcm-ibctl]'));
    expect(buttons().filter((b) => b.tabIndex === 0)).toHaveLength(1);
    buttons()[0]?.focus();
    act(() => void fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' }));
    expect(document.activeElement).toBe(buttons()[1]);
    act(() => void fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'End' }));
    expect(document.activeElement).toBe(buttons()[buttons().length - 1]);
    act(() => void fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' }));
    await waitFor(() => expect(document.activeElement).toBe(t.editor.view.dom));
  });
});
