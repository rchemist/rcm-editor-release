import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor, JSONContent } from '@tiptap/core';
import { Slice } from '@tiptap/pm/model';
import { DEFAULT_FEATURES, FEATURE_NAMES, createEditorExtensions } from '../../src/index';
import { diffDocs, formatDifferences } from '../helpers/json-equal';
import { destroyEditors, makeEditor } from '../helpers/editor';

afterEach(destroyEditors);

const names = (editor: Editor) => editor.extensionManager.extensions.map((e) => e.name);
const ext = (editor: Editor, name: string) =>
  editor.extensionManager.extensions.find((e) => e.name === name);

describe('createEditorExtensions() kit', () => {
  it('registers every built-in feature by default', () => {
    const editor = makeEditor('');
    expect(names(editor)).toEqual(expect.arrayContaining([...FEATURE_NAMES]));
    // members of the kits
    expect(Object.keys(editor.schema.nodes)).toEqual(
      expect.arrayContaining(['table', 'tableCell', 'image', 'taskList', 'taskItem', 'youtube']),
    );
    expect(Object.keys(editor.schema.marks)).toEqual(
      expect.arrayContaining([
        'textStyle',
        'highlight',
        'subscript',
        'superscript',
        'link',
        'underline',
      ]),
    );
  });

  it('every built-in can be disabled with false', () => {
    for (const name of FEATURE_NAMES) {
      const list = createEditorExtensions({ features: { [name]: false } }).map((e) => e.name);
      expect(list, name).not.toContain(name);
      // figure depends on image (its content expression names it) and goes with it.
      const removed = name === 'image' ? ['image', 'figure'] : [name];
      expect(list, name).toEqual(
        expect.not.arrayContaining(removed.map((n) => expect.objectContaining({ name: n }))),
      );
      expect(list.length, name).toBe(FEATURE_NAMES.length - removed.length);
    }
  });

  it('a disabled feature contributes no schema or commands', () => {
    const editor = makeEditor('', { features: { youtube: false, findAndReplace: false } });
    expect(editor.schema.nodes.youtube).toBeUndefined();
    expect('setYoutubeVideo' in editor.commands).toBe(false);
    expect('setSearchTerm' in editor.commands).toBe(false);
    const full = makeEditor('');
    expect('setYoutubeVideo' in full.commands).toBe(true);
    expect('setSearchTerm' in full.commands).toBe(true);
  });

  it('option objects merge onto our defaults (nested one level)', () => {
    const editor = makeEditor('', {
      features: {
        starterKit: { link: { autolink: false } },
        image: { allowBase64: true },
        highlight: {},
      },
    });
    expect(ext(editor, 'link')?.options).toMatchObject({ autolink: false, openOnClick: false });
    expect(ext(editor, 'image')?.options).toMatchObject({
      allowBase64: true,
      resize: DEFAULT_FEATURES.image.resize,
    });
    expect(ext(editor, 'highlight')?.options.multicolor).toBe(true);
    // StarterKit's trailingNode stays off: it would append a paragraph the document does not carry
    expect(names(editor)).not.toContain('trailingNode');
  });

  it('textStyleKit members can be switched individually', () => {
    const editor = makeEditor('', { features: { textStyleKit: { fontSize: false } } });
    expect('setFontSize' in editor.commands).toBe(false);
    expect('setColor' in editor.commands).toBe(true);
    // lineHeight belongs to paragraph attributes, not to textStyle
    expect(editor.schema.marks.textStyle?.spec.attrs).not.toHaveProperty('lineHeight');
    expect(editor.schema.nodes.paragraph?.spec.attrs).toHaveProperty('lineHeight');
  });

  it('lists (bullet/ordered/task, 3 levels), blockquote, rule, hardBreak, link survive JSON and HTML', () => {
    const item = (text: string, children: JSONContent[] = [], task = false): JSONContent => ({
      type: task ? 'taskItem' : 'listItem',
      ...(task ? { attrs: { checked: text.endsWith('!') } } : {}),
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }, ...children],
    });
    const nest = (type: string, task: boolean): JSONContent => ({
      type,
      content: [
        item(
          '1',
          [{ type, content: [item('1.1', [{ type, content: [item('1.1.1!', [], task)] }], task)] }],
          task,
        ),
        item('2', [], task),
      ],
    });
    const source: JSONContent = {
      type: 'doc',
      content: [
        nest('bulletList', false),
        nest('orderedList', false),
        nest('taskList', true),
        {
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'q' }] }],
        },
        { type: 'horizontalRule' },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a' },
            { type: 'hardBreak' },
            {
              type: 'text',
              text: 'link',
              marks: [{ type: 'link', attrs: { href: 'https://example.com/x' } }],
            },
          ],
        },
      ],
    };
    const loaded = makeEditor(source);
    // tiptap adds orderedList start (its spec default); compare what the source carries
    const DEFAULTED = new Set(['start']);
    const strip = (doc: JSONContent): JSONContent =>
      JSON.parse(JSON.stringify(doc), (k, v: unknown) => (DEFAULTED.has(k) ? undefined : v));
    for (const json of [loaded.getJSON(), makeEditor(loaded.getHTML()).getJSON()]) {
      const diffs = diffDocs(source, strip(json));
      expect(diffs, formatDifferences(diffs)).toEqual([]);
    }
    // no default attributes added to the link (target/rel/class stay absent)
    const link = new DOMParser()
      .parseFromString(loaded.getHTML(), 'text/html')
      .querySelector('a[href="https://example.com/x"]')!;
    expect(link.getAttributeNames().sort()).toEqual(['href']);
  });

  it('bold/italic/underline/strike/sub/superscript commands toggle their mark', () => {
    for (const [command, mark] of [
      ['toggleBold', 'bold'],
      ['toggleItalic', 'italic'],
      ['toggleUnderline', 'underline'],
      ['toggleStrike', 'strike'],
      ['toggleSubscript', 'subscript'],
      ['toggleSuperscript', 'superscript'],
    ] as const) {
      const editor = makeEditor('<p>abc</p>');
      editor.commands.selectAll();
      editor.commands[command]();
      expect(editor.getJSON().content?.[0]?.content?.[0]?.marks, command).toEqual([{ type: mark }]);
      editor.commands[command]();
      expect(editor.getJSON().content?.[0]?.content?.[0]?.marks, command).toBeUndefined();
    }
  });

  it('setTextAlign on paragraph and heading', () => {
    const editor = makeEditor('<h1>h</h1><p>p</p>');
    for (const align of ['left', 'center', 'right', 'justify']) {
      editor.commands.selectAll();
      editor.commands.setTextAlign(align);
      expect(editor.getJSON().content?.map((n) => n.attrs?.textAlign)).toEqual([align, align]);
    }
  });
});

describe('FileHandler', () => {
  const file = () => new File(['x'], 'a.png', { type: 'image/png' });
  const paste = (editor: Editor, files: File[]) => {
    const event = {
      clipboardData: { files, getData: () => '' },
      preventDefault: () => {},
      stopPropagation: () => {},
    } as unknown as ClipboardEvent;
    return editor.view.someProp('handlePaste', (f) => f(editor.view, event, Slice.empty)) ?? false;
  };

  it('without onFiles (and without the upload pipeline) pasted files are not swallowed', () => {
    const editor = makeEditor('<p>a</p>', { features: { upload: false } });
    expect(paste(editor, [file()])).toBe(false);
  });

  it('onFiles receives pasted files with the editor and source', () => {
    const onFiles = vi.fn();
    const editor = makeEditor('<p>a</p>', { onFiles });
    const f = file();
    expect(paste(editor, [f])).toBe(true);
    expect(onFiles).toHaveBeenCalledWith([f], { editor, source: 'paste', html: '' });
  });
});
