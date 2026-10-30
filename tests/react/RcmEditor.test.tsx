import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { Extension, Mark } from '@tiptap/core';
import type { Editor, JSONContent } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { createRef } from 'react';
import { renderToString } from 'react-dom/server';
import {
  RcmEditor,
  STYLES_MISSING_CODE,
  STYLES_SENTINEL_PROPERTY,
  TIPTAP_DUPLICATE_CODE,
} from '../../src/react';
import type { RcmEditorHandle, RcmEditorProps } from '../../src/react';
import { FEATURE_NAMES, getLosslessHTML } from '../../src/index';
import { diffDocs } from '../helpers/json-equal';
import { resetDevWarnings } from '../../src/react/devWarnings';
import { loadDuplicate } from '../helpers/duplicate';

const realGetComputedStyle = window.getComputedStyle;

function stubSentinel(value: string) {
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
    const style = realGetComputedStyle.call(window, el, pseudo);
    return new Proxy(style, {
      get(target, prop) {
        if (prop === 'getPropertyValue') {
          return (name: string) =>
            name === STYLES_SENTINEL_PROPERTY ? value : target.getPropertyValue(name);
        }
        const v = Reflect.get(target, prop, target);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
  });
}

async function mount(props: RcmEditorProps & { ref?: React.Ref<RcmEditorHandle> } = {}) {
  let editor: Editor | undefined;
  const utils = render(
    <RcmEditor
      {...props}
      onReady={(e) => {
        editor = e;
        props.onReady?.(e);
      }}
    />,
  );
  await waitFor(() => expect(editor).toBeDefined());
  return { ...utils, editor: editor as Editor };
}

const Probe = Extension.create({ name: 'consumerProbe' });

const Marker = Mark.create({
  name: 'consumerMarker',
  parseHTML: () => [{ tag: 'kbd' }],
  renderHTML: () => ['kbd', 0],
});

const names = (editor: Editor) => editor.extensionManager.extensions.map((e) => e.name);
const warnedCount = (warn: { mock: { calls: unknown[][] } }, code = STYLES_MISSING_CODE) =>
  warn.mock.calls.filter((c) => String(c[0]).includes(code)).length;

beforeEach(() => {
  resetDevWarnings();
  stubSentinel('1');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('RcmEditor', () => {
  it('renders the styled root and an editable ProseMirror area', async () => {
    const { container, editor } = await mount({ defaultValue: '<p>hi</p>' });
    const root = container.querySelector('[data-rcm-editor]');
    expect(root).toHaveClass('rcm-editor');
    expect(root?.querySelector('[contenteditable="true"]')).not.toBeNull();
    expect(editor.getHTML()).toBe('<p>hi</p>');
  });

  it('server render emits the root without an editor view (immediatelyRender:false)', () => {
    const html = renderToString(<RcmEditor defaultValue="<p>x</p>" />);
    expect(html).toContain('data-rcm-editor');
    expect(html).not.toContain('contenteditable');
  });

  it('onChange receives json and html after an editor command', async () => {
    const onChange = vi.fn();
    const { editor } = await mount({ onChange, changeDebounceMs: 0 });
    act(() => {
      editor.chain().insertContent('hello').run();
    });
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last.html).toBe('<p>hello</p>');
    expect(
      diffDocs(
        {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
        },
        last.json,
      ),
    ).toEqual([]);
  });

  it('extensions array is appended after the defaults and active', async () => {
    const { editor } = await mount({ extensions: [Probe, Marker] });
    expect(names(editor)).toContain('starterKit');
    expect(names(editor).slice(-2)).toEqual(['consumerProbe', 'consumerMarker']);
    act(() => {
      editor.commands.setContent('<p><kbd>m</kbd></p>');
    });
    expect(editor.getJSON().content?.[0]?.content?.[0]?.marks?.[0]?.type).toBe('consumerMarker');
  });

  it('extensions function receives defaults and its result is used as-is', async () => {
    let received: string[] = [];
    const { editor } = await mount({
      extensions: (defaults) => {
        received = defaults.map((e) => e.name);
        const replaced = defaults.map((e) =>
          e.name === 'starterKit' ? StarterKit.configure({ bold: false }) : e,
        );
        return [Probe, ...replaced];
      },
    });
    // Extension names follow feature names, except `paste` (tiptap core owns that name).
    expect(received).toEqual(FEATURE_NAMES.map((name) => (name === 'paste' ? 'rcmPaste' : name)));
    const list = names(editor);
    expect(list).not.toContain('bold');
    // Equal-priority extensions keep the returned order.
    expect(list.indexOf('consumerProbe')).toBeGreaterThanOrEqual(0);
    expect(list.indexOf('consumerProbe')).toBeLessThan(list.indexOf('starterKit'));
  });

  it('editorProps and a raw ProseMirror plugin are passed through', async () => {
    const key = new PluginKey<number>('rawPlugin');
    const raw = new Plugin<number>({
      key,
      state: { init: () => 0, apply: (tr, n) => (tr.docChanged ? n + 1 : n) },
    });
    const handleKeyDown = vi.fn(() => false);
    const { editor, container } = await mount({
      extensions: [Extension.create({ name: 'raw', addProseMirrorPlugins: () => [raw] })],
      editorProps: { attributes: { 'data-testid': 'editor-content' }, handleKeyDown },
    });
    expect(container.querySelector('[data-testid="editor-content"]')).toHaveAttribute(
      'contenteditable',
      'true',
    );
    act(() => {
      editor.commands.insertContent('a');
    });
    expect(key.getState(editor.state)).toBe(1);
    editor.view.someProp('handleKeyDown', (f) =>
      f(editor.view, new KeyboardEvent('keydown', { key: 'x' })),
    );
    expect(handleKeyDown).toHaveBeenCalled();
  });

  it('features prop disables and configures built-ins; extensions function sees the result', async () => {
    let received: string[] = [];
    const { editor } = await mount({
      features: { youtube: false, paragraphAttributes: { indentStep: '4pt' } },
      extensions: (defaults) => {
        received = defaults.map((e) => e.name);
        return defaults;
      },
    });
    expect(received).not.toContain('youtube');
    expect(received).toContain('paragraphAttributes');
    expect(editor.schema.nodes.youtube).toBeUndefined();
    act(() => {
      editor.commands.setContent('<p>a</p>');
      editor.commands.selectAll();
      editor.commands.indent();
    });
    expect(editor.getJSON().content?.[0]?.attrs?.marginLeft).toBe('4pt');
  });

  it('readonly toggles editability', async () => {
    const { editor, rerender } = await mount({ readonly: true });
    expect(editor.isEditable).toBe(false);
    rerender(<RcmEditor readonly={false} />);
    await waitFor(() => expect(editor.isEditable).toBe(true));
  });
});

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('RcmEditor contract', () => {
  it('value accepts an HTML string and tiptap JSON; onChange html === editor.getHTML()', async () => {
    const onChange = vi.fn();
    const html = await mount({ value: '<p>html</p>', onChange, changeDebounceMs: 0 });
    expect(html.editor.getText()).toBe('html');
    cleanup();
    const { editor } = await mount({ value: doc('json'), onChange, changeDebounceMs: 0 });
    expect(editor.getText()).toBe('json');
    act(() => {
      editor.commands.insertContentAt(1, 'X');
    });
    const change = onChange.mock.calls.at(-1)![0];
    expect(change.html).toBe(getLosslessHTML(editor));
    expect(diffDocs(doc('Xjson'), change.json)).toEqual([]);
  });

  it('onChange is debounced and serializes lazily', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const onChange = vi.fn();
      const { editor } = await mount({ onChange, changeDebounceMs: 50 });
      const getHTML = vi.spyOn(editor, 'getHTML');
      act(() => {
        editor.commands.insertContent('a');
        editor.commands.insertContent('b');
        editor.commands.insertContent('c');
      });
      expect(onChange).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(60);
      });
      expect(onChange).toHaveBeenCalledTimes(1);
      // Nothing was serialized for the payload until it was read.
      expect(getHTML).not.toHaveBeenCalled();
      expect(onChange.mock.calls[0]![0].html).toBe('<p>abc</p>');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a pending change is flushed on blur, by the ref handle and on unmount', async () => {
    const onChange = vi.fn();
    const ref = createRef<RcmEditorHandle>();
    const { editor, unmount } = await mount({ onChange, changeDebounceMs: 10_000, ref });
    expect(ref.current?.editor).toBe(editor);
    act(() => {
      editor.commands.insertContent('a');
    });
    act(() => ref.current!.flush());
    expect(onChange).toHaveBeenCalledTimes(1);
    act(() => {
      editor.commands.insertContent('b');
      editor.emit('blur', { editor, event: new FocusEvent('blur'), transaction: editor.state.tr });
    });
    expect(onChange).toHaveBeenCalledTimes(2);
    act(() => {
      editor.commands.insertContent('c');
    });
    unmount();
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange.mock.calls[2]![0].html).toBe('<p>abc</p>');
  });

  it('an equal external value keeps the selection; a different one replaces the content', async () => {
    const { editor, rerender } = await mount({ value: '<p>abcdef</p>' });
    act(() => {
      editor.commands.setTextSelection(4);
    });
    rerender(<RcmEditor value="<p>abcdef</p>" />);
    rerender(<RcmEditor value={doc('abcdef')} />);
    expect(editor.state.selection.from).toBe(4);
    rerender(<RcmEditor value="<p>other</p>" />);
    await waitFor(() => expect(editor.getHTML()).toBe('<p>other</p>'));
  });

  it('an echoed onChange value does not overwrite newer edits', async () => {
    const onChange = vi.fn();
    const { editor, rerender } = await mount({ value: '<p>a</p>', onChange, changeDebounceMs: 0 });
    act(() => {
      editor.commands.insertContentAt(2, 'b');
    });
    const echoed = onChange.mock.calls.at(-1)![0].html;
    act(() => {
      editor.commands.insertContentAt(3, 'c');
    });
    rerender(<RcmEditor value={echoed} onChange={onChange} changeDebounceMs={0} />);
    expect(editor.getHTML()).toBe('<p>abc</p>');
    expect(editor.state.selection.from).toBe(4);
  });

  it('controlled value replaces content without emitting onChange', async () => {
    const onChange = vi.fn();
    const { editor, rerender } = await mount({ value: '<p>a</p>', onChange, changeDebounceMs: 0 });
    rerender(<RcmEditor value="<p>b</p>" onChange={onChange} changeDebounceMs={0} />);
    await waitFor(() => expect(editor.getHTML()).toBe('<p>b</p>'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('uncontrolled: defaultValue only, edits notify onChange', async () => {
    const onChange = vi.fn();
    const { editor } = await mount({ defaultValue: '<p>x</p>', onChange, changeDebounceMs: 0 });
    act(() => {
      editor.commands.insertContentAt(2, 'y');
    });
    expect(onChange.mock.calls.at(-1)![0].html).toBe('<p>xy</p>');
  });

  it('readonly: contenteditable false, edit commands leave the JSON unchanged, value still loads', async () => {
    const onChange = vi.fn();
    const { editor, container, rerender } = await mount({
      value: '<p>ro</p>',
      readonly: true,
      onChange,
      changeDebounceMs: 0,
    });
    expect(container.querySelector('[contenteditable="true"]')).toBeNull();
    expect(container.querySelector('[data-rcm-editor]')).toHaveClass('rcm-editor--readonly');
    const before = editor.getJSON();
    act(() => {
      editor.commands.insertContent('x');
      editor.commands.toggleBold();
      editor.commands.insertDocument({ type: 'doc', content: [doc('d').content[0]!] });
    });
    expect(editor.getJSON()).toEqual(before);
    expect(onChange).not.toHaveBeenCalled();
    rerender(<RcmEditor value="<p>next</p>" readonly onChange={onChange} />);
    await waitFor(() => expect(editor.getHTML()).toBe('<p>next</p>'));
    expect(editor.isEditable).toBe(false);
  });

  it('after a fatal value, the next valid value restores the readonly prop state', async () => {
    const cyclic: { type: string; content: unknown[] } = { type: 'doc', content: [] };
    cyclic.content.push({ type: 'paragraph', attrs: { self: cyclic } });
    const { editor, rerender } = await mount({ value: '<p>ok</p>' });
    rerender(<RcmEditor value={cyclic as JSONContent} />);
    await waitFor(() => expect(editor.isEditable).toBe(false));
    // Toggling readonly during the failure does not unlock the document.
    rerender(<RcmEditor value={cyclic as JSONContent} readonly />);
    rerender(<RcmEditor value={cyclic as JSONContent} readonly={false} />);
    expect(editor.isEditable).toBe(false);
    rerender(<RcmEditor value="<p>good</p>" readonly={false} />);
    await waitFor(() => expect(editor.isEditable).toBe(true));
    rerender(<RcmEditor value={cyclic as JSONContent} />);
    rerender(<RcmEditor value={cyclic as JSONContent} readonly />);
    rerender(<RcmEditor value="<p>again</p>" readonly />);
    await waitFor(() => expect(editor.getHTML()).toBe('<p>again</p>'));
    expect(editor.isEditable).toBe(false);
  });

  it('minHeight sets the editing area min-height token', async () => {
    const { container, rerender } = await mount({ minHeight: 240 });
    const root = container.querySelector<HTMLElement>('[data-rcm-editor]')!;
    expect(root.style.getPropertyValue('--rcm-editor-min-height')).toBe('240px');
    rerender(<RcmEditor minHeight="12em" />);
    expect(root.style.getPropertyValue('--rcm-editor-min-height')).toBe('12em');
  });

  it('the editing area is a labelled multiline textbox; labels and editorProps attributes merge', async () => {
    const { container, rerender } = await mount({
      labels: { editorArea: '__area__' },
      editorProps: { attributes: { 'data-testid': 'editor-content' } },
    });
    const area = container.querySelector('[data-testid="editor-content"]')!;
    expect(area).toHaveAttribute('role', 'textbox');
    expect(area).toHaveAttribute('aria-multiline', 'true');
    expect(area).toHaveAttribute('aria-label', '__area__');
    expect(area).not.toHaveAttribute('aria-readonly');
    rerender(
      <RcmEditor readonly editorProps={{ attributes: { 'data-testid': 'editor-content' } }} />,
    );
    await waitFor(() => expect(area).toHaveAttribute('aria-readonly', 'true'));
    expect(area.getAttribute('aria-label')).toBeTruthy();
  });

  it('editorProps updates after mount are applied', async () => {
    const first = vi.fn(() => false);
    const second = vi.fn(() => false);
    const { editor, rerender } = await mount({ editorProps: { handleKeyDown: first } });
    rerender(<RcmEditor editorProps={{ handleKeyDown: second }} />);
    editor.view.someProp('handleKeyDown', (f) =>
      f(editor.view, new KeyboardEvent('keydown', { key: 'x' })),
    );
    expect(second).toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
  });

  it('resolveAsset prop resolves asset srcs and the latest prop is used', async () => {
    const a = vi.fn(() => 'https://a/1.png');
    const b = vi.fn(() => 'https://b/1.png');
    const value = {
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'asset:sha256:00' } }],
    };
    const { container, editor, rerender } = await mount({ value, resolveAsset: a });
    await waitFor(() =>
      expect(container.querySelector('img')).toHaveAttribute('src', 'https://a/1.png'),
    );
    rerender(<RcmEditor value={value} resolveAsset={b} />);
    act(() => {
      editor.commands.setContent({
        type: 'doc',
        content: [{ type: 'image', attrs: { src: 'asset:sha256:11' } }],
      });
    });
    await waitFor(() => expect(b).toHaveBeenCalledWith('asset:sha256:11'));
  });
});

describe('RcmEditor styles check', () => {
  it('warns once (sentinel code) when styles.css is missing', async () => {
    stubSentinel('');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mount();
    await mount();
    expect(warnedCount(warn)).toBe(1);
  });

  it('does not warn when the style token is present', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mount();
    expect(warnedCount(warn)).toBe(0);
  });

  it('does not warn in production', async () => {
    stubSentinel('');
    vi.stubEnv('NODE_ENV', 'production');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mount();
    expect(warnedCount(warn)).toBe(0);
  });
});

describe('RcmEditor tiptap duplicate check', () => {
  async function foreignExtensions() {
    const dupCore = await loadDuplicate<typeof import('@tiptap/core')>('@tiptap/core');
    const dupState = await loadDuplicate<typeof import('@tiptap/pm/state')>('@tiptap/pm/state');
    const plugin = new dupState.Plugin({ key: new dupState.PluginKey('foreignPlugin') });
    return [
      dupCore.Extension.create({ name: 'foreignExt', addProseMirrorPlugins: () => [plugin] }),
    ] as unknown as RcmEditorProps['extensions'];
  }

  it('warns once (duplicate code) for extensions from another tiptap install', async () => {
    const extensions = await foreignExtensions();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { editor } = await mount({ extensions });
    await mount({ extensions });
    expect(warnedCount(warn, TIPTAP_DUPLICATE_CODE)).toBe(1);
    // tiptap itself still runs the foreign extension in this case.
    expect(names(editor)).toContain('foreignExt');
  });

  it('no duplicate warning for a single install', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mount({ extensions: [Probe] });
    expect(warnedCount(warn, TIPTAP_DUPLICATE_CODE)).toBe(0);
  });

  it('duplicate check is a no-op in production', async () => {
    const extensions = await foreignExtensions();
    vi.stubEnv('NODE_ENV', 'production');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mount({ extensions });
    expect(warnedCount(warn, TIPTAP_DUPLICATE_CODE)).toBe(0);
  });
  it('unknown content: onContentReport fires, the document is not emptied, onChange json re-emits it', async () => {
    const mystery = { type: 'mysteryBlock', attrs: { k: 1 } };
    const value = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'keep' }] }, mystery],
    };
    const onContentReport = vi.fn();
    const onChange = vi.fn();
    const { editor, container } = await mount({
      defaultValue: value,
      onContentReport,
      onChange,
      changeDebounceMs: 0,
    });
    expect(onContentReport).toHaveBeenCalledTimes(1);
    expect(onContentReport.mock.calls[0]![0].unsupported).toEqual([
      expect.objectContaining({
        kind: 'node',
        type: 'mysteryBlock',
        path: 'content[1](mysteryBlock)',
      }),
    ]);
    expect(editor.getText()).toContain('keep');
    expect(container.querySelector('[data-unsupported-type="mysteryBlock"]')).not.toBeNull();
    act(() => {
      editor.commands.insertContentAt(1, 'X');
    });
    const json = onChange.mock.calls.at(-1)?.[0].json;
    expect(json.content[1]).toEqual(mystery);
    expect(json.content[0].content[0].text).toBe('Xkeep');
  });

  it('HTML elements without a rule become rawHtml instead of dropping (no throw from the content check)', async () => {
    const onContentReport = vi.fn();
    const { editor } = await mount({
      defaultValue: '<p>a</p><center>b</center>',
      onContentReport,
    });
    expect(editor.getText()).toContain('a');
    expect(onContentReport).toHaveBeenCalledTimes(1);
    const report = onContentReport.mock.calls[0]![0];
    expect(report.unknownHtml).toEqual([]);
    expect(report.rawHtml.map((u: { path: string }) => u.path)).toEqual(['[1](center)']);
    expect(getLosslessHTML(editor)).toBe('<p>a</p><center>b</center>');
  });
});
