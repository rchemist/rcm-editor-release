import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { createListgridEditor, RcmListgridEditor } from '../../src/listgrid';
import type { RcmListgridEditorOptions, RcmListgridInputProps } from '../../src/listgrid';
import { getLosslessHTML } from '../../src';

const here = dirname(fileURLToPath(import.meta.url));

type OnChange = NonNullable<RcmListgridInputProps['onChange']>;
type OnChangeMock = Mock<OnChange>;

async function mountListgrid(
  props: Partial<RcmListgridInputProps> = {},
  options: RcmListgridEditorOptions = {},
) {
  let editor: Editor | undefined;
  const onChange: OnChangeMock = vi.fn<OnChange>();
  const Comp = createListgridEditor({
    ...options,
    onReady: (e) => {
      editor = e;
      options.onReady?.(e);
    },
  });
  const utils = render(
    <Comp name="body" value="" {...props} onChange={props.onChange ?? onChange} />,
  );
  await waitFor(() => expect(editor).not.toBeUndefined());
  return { ...utils, editor: editor as Editor, onChange, Comp };
}

/** Flush RcmEditor's debounced onChange without timers (blur flushes pending changes). */
function blurFlush(editor: Editor) {
  act(() => {
    editor.emit('blur', {
      editor,
      event: new FocusEvent('blur'),
      transaction: editor.state.tr,
    });
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('listgrid adapter', () => {
  it('string value renders; editing emits an HTML string with propagation false', async () => {
    const { editor, onChange } = await mountListgrid({ value: '<p>hello</p>' });
    expect(editor.getText()).toBe('hello');
    act(() => {
      editor.commands.insertContentAt(6, '!');
    });
    blurFlush(editor);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.any(String), false);
    expect(onChange.mock.calls[0]![0]).toBe('<p>hello!</p>');
  });

  it('adapter chrome: root class, data-field-name, aria-invalid only with errors', async () => {
    const first = await mountListgrid({ value: '<p>x</p>', errors: ['bad'] });
    expect(first.container.querySelector('.rcm-listgrid-editor')).not.toBeNull();
    expect(first.container.querySelector('[data-field-name="body"]')).not.toBeNull();
    expect(first.container.querySelector('[role="textbox"]')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(first.container.textContent).not.toContain('bad');
    cleanup();
    const second = await mountListgrid({ value: '<p>x</p>' });
    expect(second.container.querySelector('[role="textbox"]')).not.toHaveAttribute('aria-invalid');
  });

  it('createListgridEditor passes options through; component identity is stable', async () => {
    expect(RcmListgridEditor.displayName).toBe('RcmListgridEditor');
    const A = createListgridEditor({ toolbar: false, minHeight: 100 });
    expect(A.displayName).toBe('RcmListgridEditor');
    expect(A).not.toBe(createListgridEditor());
    const onChange = vi.fn<OnChange>();
    const { container, rerender } = render(<A name="f" value="<p>x</p>" onChange={onChange} />);
    await waitFor(() => expect(container.querySelector('[data-rcm-editor]')).not.toBeNull());
    // toolbar:false hides the toolbar …
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
    // … and minHeight:100 becomes 100px (default is 20rem).
    expect(
      container
        .querySelector<HTMLElement>('[data-rcm-editor]')!
        .style.getPropertyValue('--rcm-editor-min-height'),
    ).toBe('100px');
    rerender(<A name="f" value="<p>y</p>" onChange={onChange} />);
    await waitFor(() => expect(container.querySelector('.tiptap')?.textContent).toBe('y'));
    cleanup();
    const { container: plain } = render(
      <RcmListgridEditor name="g" value="<p>z</p>" onChange={vi.fn<OnChange>()} />,
    );
    await waitFor(() => expect(plain.querySelector('[data-rcm-editor]')).not.toBeNull());
    expect(
      plain
        .querySelector<HTMLElement>('[data-rcm-editor]')!
        .style.getPropertyValue('--rcm-editor-min-height'),
    ).toBe('20rem');
  });

  it('empty-ish values load as empty docs', async () => {
    for (const value of ['', undefined, null, 42, { type: 'doc' }]) {
      const { editor, unmount } = await mountListgrid({ value: value as string });
      expect(editor.getText()).toBe('');
      unmount();
      cleanup();
    }
  });

  it("clearing the document emits '' with propagation false", async () => {
    const { editor, onChange } = await mountListgrid({ value: '<p>hi</p>' });
    act(() => {
      editor.commands.clearContent();
    });
    blurFlush(editor);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('', false);
  });

  it("'<p></p>' loads empty and an untouched doc emits nothing", async () => {
    const { editor, onChange } = await mountListgrid({ value: '<p></p>' });
    expect(editor.getText()).toBe('');
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('docs with only an image, hr or table are not empty', async () => {
    const cases = [
      '<img src="https://example.com/a.png" alt="a">',
      '<hr>',
      '<table><tbody><tr><td><p>c</p></td></tr></tbody></table>',
    ];
    for (const value of cases) {
      const { editor, onChange } = await mountListgrid({ value });
      act(() => {
        editor.commands.insertContentAt(editor.state.doc.content.size, 'x');
      });
      blurFlush(editor);
      expect(onChange).toHaveBeenCalledTimes(1);
      const html: string = onChange.mock.calls[0]![0];
      expect(html).not.toBe('');
      expect(html).toContain('x');
      cleanup();
    }
  });

  it('edits inside 100ms emit once with the lossless HTML', async () => {
    const { editor, onChange } = await mountListgrid({ value: '<p>a</p>' });
    act(() => {
      editor.commands.insertContentAt(2, 'x');
      editor.commands.insertContentAt(3, 'y');
      editor.commands.insertContentAt(4, 'z');
    });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0]).toBe(getLosslessHTML(editor));
    expect(onChange.mock.calls[0]![0]).toBe('<p>axyz</p>');
  });

  it('readonly renders no editable area', async () => {
    const { container } = await mountListgrid({ value: '<p>ro</p>', readonly: true });
    expect(container.querySelector('[contenteditable="true"]')).toBeNull();
    expect(container.querySelector('[data-rcm-editor]')).toHaveClass('rcm-editor--readonly');
  });

  it('an echoed emit keeps selection and undo history', async () => {
    const { editor, rerender, onChange, Comp } = await mountListgrid({
      value: '<p>abcdef</p>',
    });
    act(() => {
      editor.commands.insertContentAt(4, 'X');
    });
    const selectionBefore = editor.state.selection.from;
    blurFlush(editor);
    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted: string = onChange.mock.calls[0]![0];
    expect(emitted).toBe('<p>abcXdef</p>');
    rerender(<Comp name="body" value={emitted} onChange={onChange} />);
    expect(editor.state.selection.from).toBe(selectionBefore);
    expect(editor.getHTML()).toBe('<p>abcXdef</p>');
    act(() => {
      editor.commands.undo();
    });
    expect(editor.getHTML()).toBe('<p>abcdef</p>');
  });

  it("an echoed '' after clearing keeps undo history", async () => {
    const { editor, rerender, onChange, Comp } = await mountListgrid({
      value: '<p>gone</p>',
    });
    act(() => {
      editor.commands.clearContent();
    });
    blurFlush(editor);
    expect(onChange).toHaveBeenCalledWith('', false);
    rerender(<Comp name="body" value="" onChange={onChange} />);
    expect(editor.getText()).toBe('');
    act(() => {
      editor.commands.undo();
    });
    expect(editor.getHTML()).toBe('<p>gone</p>');
  });

  it('equivalent re-serialized HTML keeps cursor and undo; a different value replaces', async () => {
    const { editor, rerender, onChange, Comp } = await mountListgrid({
      value: '<p>hi</p><div class="x" data-y="1">a</div>',
    });
    act(() => {
      editor.commands.insertContentAt(3, '!');
    });
    const selectionBefore = editor.state.selection.from;
    blurFlush(editor);
    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted: string = onChange.mock.calls[0]![0];
    expect(emitted).toContain('<div class="x" data-y="1">a</div>');
    // Server-normalized but equivalent: attribute order swapped, whitespace between blocks.
    const equivalent = `\n  ${emitted
      .replace('<div class="x" data-y="1">', '<div data-y="1" class="x">')
      .replace(/<\/p><div/g, '</p>\n\n<div')}\n`;
    expect(equivalent).not.toBe(emitted);
    rerender(<Comp name="body" value={equivalent} onChange={onChange} />);
    expect(editor.state.selection.from).toBe(selectionBefore);
    expect(editor.getHTML()).toBe(emitted);
    act(() => {
      editor.commands.undo();
    });
    expect(editor.getHTML()).toContain('<p>hi</p>');
    // A genuinely different value still replaces the content.
    rerender(<Comp name="body" value="<p>other</p>" onChange={onChange} />);
    await waitFor(() => expect(editor.getHTML()).toBe('<p>other</p>'));
  });

  it('a changed attribute inside preserved raw HTML is not treated as equivalent', async () => {
    const { editor, rerender, onChange, Comp } = await mountListgrid({
      value: '<p>hi</p><div class="x" data-y="1">a</div>',
    });
    act(() => {
      editor.commands.insertContentAt(3, '!');
    });
    blurFlush(editor);
    const emitted: string = onChange.mock.calls[0]![0];
    const changed = emitted.replace('data-y="1"', 'data-y="2"');
    expect(changed).not.toBe(emitted);
    rerender(<Comp name="body" value={changed} onChange={onChange} />);
    await waitFor(() => expect(editor.getHTML()).toContain('data-y="2"'));
  });

  it('listgrid subpath avoids the listgrid package; core entries stay independent', () => {
    const importListgrid =
      /(^|\s)(import|export)[^'"]*['"]@rchemist\/listgrid['"]|require\(\s*['"]@rchemist\/listgrid['"]\s*\)|import\(\s*['"]@rchemist\/listgrid['"]\s*\)/;
    const listgridDir = join(here, '../../src/listgrid');
    for (const file of readdirSync(listgridDir)) {
      const text = readFileSync(join(listgridDir, file), 'utf8');
      expect(text, `${file} must not import the listgrid package`).not.toMatch(importListgrid);
      expect(text, `${file} must not mention the listgrid package`).not.toContain(
        '@rchemist/listgrid',
      );
    }
    for (const entry of ['../../src/index.ts', '../../src/react/index.ts']) {
      const text = readFileSync(join(here, entry), 'utf8');
      expect(`${entry}: ${text}`).not.toContain('listgrid');
    }
  });

  it('legacy html code blocks unwrap by default and stay with the option off', async () => {
    const legacy = '<pre><code class="language-html">&lt;p&gt;x&lt;/p&gt;</code></pre>';
    const { editor } = await mountListgrid({ value: legacy });
    expect(editor.getHTML()).toContain('<p>x</p>');
    expect(editor.getHTML()).not.toContain('<pre>');
    cleanup();
    const kept = await mountListgrid({ value: legacy }, { unwrapHtmlCodeBlocks: false });
    expect(kept.editor.getHTML()).toContain('language-html');
  });

  it('rawHtml fragment is untouched without edits and verbatim after an edit', async () => {
    const fragment = '<div class="x" data-y="1">a</div>';
    const { editor, onChange } = await mountListgrid({
      value: `<p>hi</p>${fragment}`,
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      editor.commands.insertContentAt(3, '!');
    });
    blurFlush(editor);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0]).toContain(fragment);
  });

  it('placeHolder becomes the empty-editor hint', async () => {
    const { editor } = await mountListgrid({
      value: '',
      placeHolder: 'Write here',
    });
    const hint = editor.extensionManager.extensions.find((e) => e.name === 'emptyPlaceholder');
    expect(hint?.options.placeholder).toBe('Write here');
    cleanup();
    const fallback = await mountListgrid({ value: '' });
    const fallbackHint = fallback.editor.extensionManager.extensions.find(
      (e) => e.name === 'emptyPlaceholder',
    );
    expect(fallbackHint?.options.placeholder).toBe('');
  });
});
