import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { FindAndReplacePluginKey } from '@tiptap/extension-find-and-replace';
import { RcmEditor } from '../../src/react';
import type { RcmEditorProps } from '../../src/react';
import { STYLES_SENTINEL_PROPERTY } from '../../src/react';
import { resetDevWarnings } from '../../src/react/devWarnings';

// jsdom has no layout: ProseMirror's scrollIntoView (run by focus()/goTo*Result) needs these.
const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = emptyRects;
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
}

beforeEach(() => {
  resetDevWarnings();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  void STYLES_SENTINEL_PROPERTY;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
  return { ...utils, editor: ed, q, must };
}

const click = (el: HTMLElement) => act(() => void fireEvent.click(el));
const type = (el: HTMLElement, value: string) =>
  act(() => void fireEvent.change(el, { target: { value } }));
const keyDown = (el: HTMLElement, init: Record<string, unknown> = {}) =>
  act(() => void fireEvent.keyDown(el, init));

/** Opens the panel with the toolbar `find` item and focuses the find input. */
async function openPanel(t: Awaited<ReturnType<typeof mount>>) {
  click(t.must('rcm-tb-find'));
  const input = t.must('rcm-find-input');
  await waitFor(() => expect(document.activeElement).toBe(input));
  return input as HTMLInputElement;
}

const countOf = (t: Awaited<ReturnType<typeof mount>>) => {
  const el = t.must('rcm-find-count');
  return { current: Number(el.dataset.current), total: Number(el.dataset.total) };
};

const decorated = (t: Awaited<ReturnType<typeof mount>>) =>
  t.editor.view.dom.querySelectorAll('.find-and-replace-result').length;

const resultsOf = (t: Awaited<ReturnType<typeof mount>>) =>
  FindAndReplacePluginKey.getState(t.editor.state)?.results.length ?? -1;

const textOf = (t: Awaited<ReturnType<typeof mount>>) =>
  t.editor.state.doc.textBetween(0, t.editor.state.doc.content.size, '\n');

describe('find panel basics', () => {
  it('opens focused from the toolbar item; the count shows 0/0 without matches', async () => {
    const t = await mount({ defaultValue: '<p>abc</p>' });
    const input = await openPanel(t);
    expect(input).toHaveAttribute('aria-label', '찾을 내용');
    expect(t.must('rcm-find-panel')).toHaveAttribute('role', 'search');
    type(input, 'abc');
    await waitFor(() => expect(countOf(t)).toEqual({ current: 1, total: 1 }));
    type(input, 'zz');
    await waitFor(() => expect(countOf(t)).toEqual({ current: 0, total: 0 }));
    expect(t.must('rcm-find-prev')).toBeDisabled();
    expect(t.must('rcm-find-next')).toBeDisabled();
    expect(t.must('rcm-find-replace')).toBeDisabled();
    expect(t.must('rcm-find-replace-all')).toBeDisabled();
  });

  it('Mod-F opens the panel; findShortcut=false leaves the event untouched', async () => {
    const t = await mount({ defaultValue: '<p>abc</p>' });
    keyDown(t.editor.view.dom, { key: 'f', metaKey: true });
    expect(t.q('rcm-find-panel')).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(t.must('rcm-find-input')));
    cleanup();

    const off = await mount({ defaultValue: '<p>abc</p>', findShortcut: false });
    const event = new KeyboardEvent('keydown', {
      key: 'f',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    off.editor.view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(off.q('rcm-find-panel')).toBeNull();
  });

  it('Esc closes the panel, clears the highlights and refocuses the editing area', async () => {
    const t = await mount({ defaultValue: '<p>abc abc</p>' });
    const input = await openPanel(t);
    type(input, 'abc');
    await waitFor(() => expect(decorated(t)).toBe(2));
    keyDown(input, { key: 'Escape' });
    expect(t.q('rcm-find-panel')).toBeNull();
    expect(decorated(t)).toBe(0);
    expect(resultsOf(t)).toBe(0);
    await waitFor(() => expect(document.activeElement).toBe(t.editor.view.dom));
  });

  it('repeated Mod-F refocuses the input and selects the existing term', async () => {
    const t = await mount({ defaultValue: '<p>abc</p>' });
    const input = await openPanel(t);
    type(input, 'abc');
    keyDown(input, { key: 'f', metaKey: true });
    const input2 = t.must('rcm-find-input') as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(input2));
    expect(input2.value).toBe('abc');
    expect(input2.selectionStart).toBe(0);
    expect(input2.selectionEnd).toBe(3);
  });

  it('Enter and Shift+Enter cycle through the results (wrapping)', async () => {
    const t = await mount({ defaultValue: '<p>abc abc abc</p>' });
    const input = await openPanel(t);
    type(input, 'abc');
    await waitFor(() => expect(countOf(t).total).toBe(3));
    keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(countOf(t).current).toBe(2));
    keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(countOf(t).current).toBe(3));
    keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(countOf(t).current).toBe(1));
    keyDown(input, { key: 'Enter', shiftKey: true });
    await waitFor(() => expect(countOf(t).current).toBe(3));
  });
});

describe('search results', () => {
  it('the count equals the real occurrence and decoration counts', async () => {
    const t = await mount({ defaultValue: '<p>abc abc abc</p>' });
    const input = await openPanel(t);
    type(input, 'abc');
    await waitFor(() => expect(countOf(t)).toEqual({ current: 1, total: 3 }));
    expect(resultsOf(t)).toBe(3);
    // Each match sits inside one text node, so the decoration count must match too.
    expect(decorated(t)).toBe(3);
  });

  it('a match may span a mark boundary ("한글")', async () => {
    const t = await mount({ defaultValue: '<p><strong>한</strong>글 문서</p>' });
    const input = await openPanel(t);
    type(input, '한글');
    await waitFor(() => expect(countOf(t)).toEqual({ current: 1, total: 1 }));
    const results = FindAndReplacePluginKey.getState(t.editor.state)?.results ?? [];
    expect(results[0]?.from).toBe(1);
    expect(results[0]?.to).toBe(3);
  });

  it('the case-sensitivity toggle changes the count', async () => {
    const t = await mount({ defaultValue: '<p>abc ABC Abc</p>' });
    const input = await openPanel(t);
    type(input, 'abc');
    await waitFor(() => expect(countOf(t).total).toBe(3));
    const toggle = t.must('rcm-find-case');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    click(toggle);
    await waitFor(() => expect(countOf(t).total).toBe(1));
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    click(toggle);
    await waitFor(() => expect(countOf(t).total).toBe(3));
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  it('highlights are decorations only — never in getJSON/getHTML/onChange', async () => {
    const changes: string[] = [];
    const t = await mount({
      defaultValue: '<p>abc abc abc</p>',
      changeDebounceMs: 0,
      onChange: (change) => changes.push(change.html),
    });
    const input = await openPanel(t);
    type(input, 'abc');
    await waitFor(() => expect(decorated(t)).toBe(3));
    expect(JSON.stringify(t.editor.getJSON())).not.toContain('find-and-replace');
    expect(t.editor.getHTML()).not.toContain('find-and-replace');
    // Searching changes nothing in the document: no onChange at all.
    expect(changes).toEqual([]);
    type(t.must('rcm-replace-input'), 'X');
    click(t.must('rcm-find-replace-all'));
    await waitFor(() => expect(textOf(t)).toBe('X X X'));
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[changes.length - 1]).not.toContain('find-and-replace');
  });
});

describe('replace', () => {
  it('the current replace is reflected in the JSON and jumps to the next result', async () => {
    const t = await mount({ defaultValue: '<p>foo bar foo</p>' });
    const input = await openPanel(t);
    type(input, 'foo');
    type(t.must('rcm-replace-input'), 'X');
    await waitFor(() => expect(countOf(t)).toEqual({ current: 1, total: 2 }));
    click(t.must('rcm-find-replace'));
    await waitFor(() => expect(textOf(t)).toBe('X bar foo'));
    await waitFor(() => expect(countOf(t)).toEqual({ current: 1, total: 1 }));
    expect(JSON.stringify(t.editor.getJSON())).toContain('X bar foo');
  });

  it('replace-all is reflected in the JSON and undone by a single undo', async () => {
    const t = await mount({ defaultValue: '<p>foo bar foo end</p>' });
    const input = await openPanel(t);
    type(input, 'foo');
    type(t.must('rcm-replace-input'), 'X');
    await waitFor(() => expect(countOf(t).total).toBe(2));
    click(t.must('rcm-find-replace-all'));
    await waitFor(() => expect(textOf(t)).toBe('X bar X end'));
    expect(JSON.stringify(t.editor.getJSON())).toContain('X bar X end');
    act(() => void t.editor.commands.undo());
    expect(textOf(t)).toBe('foo bar foo end');
  });

  it('readonly opens the panel without the replace row and still searches', async () => {
    const t = await mount({ readonly: true, defaultValue: '<p>abc abc</p>' });
    // The read-only editing area stays focusable so Mod-F can reach it.
    expect(t.editor.view.dom.getAttribute('tabindex')).toBe('0');
    keyDown(t.editor.view.dom, { key: 'f', ctrlKey: true });
    expect(t.q('rcm-find-panel')).not.toBeNull();
    expect(t.q('rcm-replace-input')).toBeNull();
    expect(t.q('rcm-find-replace')).toBeNull();
    expect(t.q('rcm-find-replace-all')).toBeNull();
    const input = t.must('rcm-find-input') as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(input));
    type(input, 'abc');
    await waitFor(() => expect(countOf(t)).toEqual({ current: 1, total: 2 }));
    expect(decorated(t)).toBe(2);
  });
});

describe('spellcheck', () => {
  it('the editing area has spellcheck="true" by default', async () => {
    const t = await mount({ defaultValue: '<p>abc</p>' });
    expect(t.editor.view.dom.getAttribute('spellcheck')).toBe('true');
  });

  it('consumer editorProps.attributes still override spellcheck', async () => {
    const t = await mount({
      defaultValue: '<p>abc</p>',
      editorProps: { attributes: { spellcheck: 'false' } },
    });
    expect(t.editor.view.dom.getAttribute('spellcheck')).toBe('false');
  });
});
