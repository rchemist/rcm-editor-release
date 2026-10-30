import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import type { EditorView } from '@codemirror/view';
import { RcmEditor } from '../../src/react';
import type { RcmEditorChange, RcmEditorProps } from '../../src/react';
import { STYLES_SENTINEL_PROPERTY } from '../../src/react';
import { resetDevWarnings } from '../../src/react/devWarnings';
import * as codemirrorModule from '../../src/react/source/codemirror';
import { getLosslessHTML } from '../../src/index';

// jsdom has no layout: ProseMirror's scrollIntoView (run by focus()) needs these.
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
const keyDown = (el: HTMLElement, init: Record<string, unknown> = {}) =>
  act(() => void fireEvent.keyDown(el, init));

/** The CodeMirror view of a mounted host (set once the lazy load has resolved). */
async function cmView(
  q: (id: string) => HTMLElement | null,
  id = 'rcm-source-editor',
): Promise<EditorView> {
  return waitFor(() => {
    const el = q(id) as (HTMLElement & { __rcmCodeMirror?: EditorView }) | null;
    if (el?.__rcmCodeMirror) return el.__rcmCodeMirror;
    throw new Error(`CodeMirror ${id} not ready`);
  });
}

/** Replaces the whole source text in one dispatch (one change event). */
const setSource = (view: EditorView, text: string) =>
  act(() => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  });

const noticeReasons = (t: Awaited<ReturnType<typeof mount>>) =>
  Array.from(t.container.querySelectorAll('[data-testid="rcm-html-notice-item"]')).map((el) =>
    el.getAttribute('data-reason'),
  );

describe('source toggle availability and lazy loading', () => {
  it('the toggle reflects the mode; sourceMode=false and readonly hide it', async () => {
    const t = await mount({ defaultValue: '<p>abc</p>' });
    const btn = t.must('rcm-tb-source');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    click(btn);
    await waitFor(() => expect(t.must('rcm-tb-source')).toHaveAttribute('aria-pressed', 'true'));
    expect(t.must('rcm-source-editor')).not.toBeNull();
    // The editing area stays mounted, just hidden (unmounting would reset the editor DOM).
    expect(t.editor.view.dom.closest('[hidden]')).not.toBeNull();
    cleanup();

    const off = await mount({ defaultValue: '<p>abc</p>', sourceMode: false });
    expect(off.q('rcm-tb-source')).toBeNull();
    cleanup();

    const ro = await mount({ defaultValue: '<p>abc</p>', readonly: true });
    expect(ro.q('rcm-tb-source')).toBeNull();
  });

  it('CodeMirror loads only when a source editor is first shown', async () => {
    const spy = vi.spyOn(codemirrorModule, 'loadCodeMirror');
    const t = await mount({ defaultValue: '<p>abc</p>' });
    expect(spy).not.toHaveBeenCalled();
    click(t.must('rcm-tb-source'));
    expect(spy).toHaveBeenCalledTimes(1);
    await cmView(t.q);
  });
});

describe('source mode roundtrip', () => {
  it('entry shows getLosslessHTML verbatim; an unchanged exit never touches the document', async () => {
    const t = await mount({ defaultValue: '<div class="a">x</div><p>abc</p>' });
    // One committed edit so the undo history is non-empty. (The load selection is a NodeSelection
    // over the raw node — move into the text first so typing does not replace it.)
    act(() => {
      t.editor.commands.focus();
      t.editor.commands.setTextSelection(2);
      t.editor.commands.insertContent('Z');
    });
    const beforeDoc = t.editor.state.doc.toJSON();
    const couldUndo = t.editor.can().undo();

    click(t.must('rcm-tb-source'));
    const view = await cmView(t.q);
    expect(view.state.doc.toString()).toBe(getLosslessHTML(t.editor));
    expect(view.state.doc.toString()).toContain('<div class="a">x</div>');

    click(t.must('rcm-tb-source')); // unchanged: no apply at all
    await waitFor(() => expect(t.q('rcm-source-editor')).toBeNull());
    expect(t.editor.state.doc.toJSON()).toEqual(beforeDoc);
    expect(t.editor.can().undo()).toBe(couldUndo);
    expect(t.editor.view.dom.closest('[hidden]')).toBeNull();
  });

  it('a changed source applies in one transaction (single undo) and emits onChange', async () => {
    const changes: RcmEditorChange[] = [];
    const t = await mount({
      defaultValue: '<p>abc</p>',
      changeDebounceMs: 0,
      onChange: (c) => changes.push(c),
    });
    click(t.must('rcm-tb-source'));
    const view = await cmView(t.q);
    setSource(view, '<p>abc</p><p>def</p>');
    click(t.must('rcm-tb-source'));
    await waitFor(() => expect(t.editor.state.doc.textContent).toContain('def'));
    expect(t.q('rcm-source-editor')).toBeNull();
    // One undo step returns to the pre-apply document.
    act(() => void t.editor.commands.undo());
    expect(t.editor.state.doc.textContent).not.toContain('def');
    expect(changes.some((c) => c.html.includes('def'))).toBe(true);
  });

  it('onChange during source mode describes the source, not the hidden document', async () => {
    const changes: RcmEditorChange[] = [];
    const t = await mount({
      defaultValue: '<p>abc</p>',
      changeDebounceMs: 0,
      onChange: (c) => changes.push(c),
    });
    click(t.must('rcm-tb-source'));
    const view = await cmView(t.q);
    setSource(view, '<p>abc</p><div class="k">y</div>');
    await waitFor(() => expect(changes.length).toBeGreaterThan(0));
    const last = changes[changes.length - 1] as RcmEditorChange;
    // html: the source with the policy applied (sanitize keeps the div verbatim).
    expect(last.html).toContain('<div class="k">y</div>');
    // json: its parse — the non-round-tripping block stays as a rawHtml node, not lost.
    expect(JSON.stringify(last.json)).toContain('rawHtml');
    expect(JSON.stringify(last.json)).toContain('abc');
  });

  it('unmount during source mode still delivers the latest payload', async () => {
    const changes: RcmEditorChange[] = [];
    const t = await mount({
      defaultValue: '<p>abc</p>',
      changeDebounceMs: 100,
      onChange: (c) => changes.push(c),
    });
    click(t.must('rcm-tb-source'));
    const view = await cmView(t.q);
    setSource(view, '<p>abc</p><p>late</p>');
    cleanup(); // before the debounce fires
    expect(changes.some((c) => c.html.includes('late'))).toBe(true);
  });
});

describe('preservation notice', () => {
  it('no notice on load; a source apply lists kept fragments and removals with data-reason', async () => {
    const t = await mount({ defaultValue: '<div class="a">x</div>' });
    // The load report is for onContentReport only — no notice.
    expect(t.q('rcm-html-notice')).toBeNull();

    click(t.must('rcm-tb-source'));
    const view = await cmView(t.q);
    setSource(view, '<p>abc</p><script>alert(1)</script><div class="k">y</div>');
    click(t.must('rcm-tb-source'));
    await waitFor(() => expect(t.q('rcm-html-notice')).not.toBeNull());
    expect(t.must('rcm-html-notice')).toHaveAttribute('role', 'status');
    const reasons = noticeReasons(t);
    expect(reasons).toContain('element'); // div kept verbatim as rawHtml
    expect(reasons).toContain('script'); // the sanitize policy removed the script
    click(t.must('rcm-html-notice-close'));
    await waitFor(() => expect(t.q('rcm-html-notice')).toBeNull());
  });
});

describe('rawHtml fragment editor', () => {
  it('Enter on a selected raw node opens the popover; convert unwraps accepting the loss', async () => {
    const t = await mount({ defaultValue: '<div class="a">x</div>' });
    expect(t.editor.state.doc.child(0).type.name).toBe('rawHtml');
    act(() => {
      t.editor.commands.focus();
      t.editor.commands.setNodeSelection(0); // the raw node is the first child (leaf, pos 0)
    });
    keyDown(t.editor.view.dom, { key: 'Enter' });
    await waitFor(() => expect(t.q('rcm-raw-editor')).not.toBeNull());
    // No unwrap happens before an explicit action.
    expect(t.editor.state.doc.child(0).type.name).toBe('rawHtml');
    click(t.must('rcm-raw-convert'));
    await waitFor(() => expect(t.editor.state.doc.child(0).type.name).toBe('paragraph'));
    expect(t.editor.state.doc.textContent).toContain('x');
    await waitFor(() => expect(t.q('rcm-html-notice')).not.toBeNull());
    expect(noticeReasons(t)).toContain('element');
  });

  it('double-click opens the popover; apply turns a now-round-tripping fragment into blocks', async () => {
    const t = await mount({ defaultValue: '<div class="a">x</div>' });
    const preview = t.container.querySelector('[data-rcm-raw-html-preview]');
    expect(preview).not.toBeNull();
    act(() => void fireEvent.doubleClick(preview as Element));
    await waitFor(() => expect(t.q('rcm-raw-editor')).not.toBeNull());
    const view = await cmView(t.q, 'rcm-raw-editor-source');
    setSource(view, '<p>plain</p>');
    click(t.must('rcm-raw-apply'));
    await waitFor(() => expect(t.editor.state.doc.child(0).type.name).toBe('paragraph'));
    expect(t.editor.state.doc.child(0).textContent).toBe('plain');
    expect(t.q('rcm-raw-editor')).toBeNull();
    // Nothing was kept or removed: no notice.
    expect(t.q('rcm-html-notice')).toBeNull();
  });
});
