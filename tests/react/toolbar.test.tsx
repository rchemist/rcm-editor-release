import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { Editor, JSONContent } from '@tiptap/core';
import { DEFAULT_EDITOR_LABELS, DEFAULT_FONTS, RcmEditor, TOOLBAR_PRESETS } from '../../src/react';
import type { RcmEditorProps, RcmToolbarEntry } from '../../src/react';
import { TOOLBAR_ITEM_KEYS } from '../../src/react/toolbar/items';
import { STYLES_SENTINEL_PROPERTY } from '../../src/react';
import { resetDevWarnings } from '../../src/react/devWarnings';

// jsdom has no layout: ProseMirror's scrollIntoView (run by focus()) needs these.
const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = emptyRects;
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
}

// The styles sentinel is a dev warning only; silence it instead of importing the CSS.
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
  const tbIds = () =>
    Array.from(utils.container.querySelectorAll<HTMLElement>('[data-testid^="rcm-tb-"]')).map(
      (el) => el.dataset.testid as string,
    );
  return { ...utils, editor: ed, q, must, tbIds };
}

const selectAll = (editor: Editor) => act(() => void editor.commands.selectAll());
const click = (el: HTMLElement) => act(() => void fireEvent.click(el));

function marksOf(editor: Editor): string[] {
  const text = (editor.getJSON().content?.[0]?.content?.[0] ?? {}) as JSONContent;
  return (text.marks ?? []).map((m) => m.type).sort();
}

describe('toolbar rendering', () => {
  it('default is the full preset; simple renders the simple preset set', async () => {
    // `uploadFile` is configured so the availability-gated `file` item is on the bar too;
    // its absence without a file uploader is covered in upload.test.tsx.
    const full = await mount({ uploadFile: async () => 'https://cdn.test/a.pdf' });
    const ids = (preset: 'simple' | 'full') =>
      TOOLBAR_PRESETS[preset].filter((e) => e !== '|').map((k) => `rcm-tb-${k as string}`);
    expect(full.tbIds().sort()).toEqual([...ids('full')].sort());
    expect(full.container.querySelector('[role="toolbar"]')).not.toBeNull();
    cleanup();
    const simple = await mount({
      toolbar: 'simple',
      uploadFile: async () => 'https://cdn.test/a.pdf',
    });
    expect(simple.tbIds().sort()).toEqual([...ids('simple')].sort());
  });

  it('toolbar:false and readonly render no toolbar', async () => {
    expect(
      (await mount({ toolbar: false })).container.querySelector('[role="toolbar"]'),
    ).toBeNull();
    cleanup();
    expect(
      (await mount({ readonly: true })).container.querySelector('[role="toolbar"]'),
    ).toBeNull();
  });

  it('config: items / hide / custom items / start+end slots', async () => {
    const run = vi.fn();
    const items: RcmToolbarEntry[] = [
      'bold',
      '|',
      '|',
      'italic',
      { key: 'x', label: 'X', run, isActive: () => true },
      '|',
    ];
    const t = await mount({
      toolbar: {
        items,
        hide: ['italic'],
        start: <i data-testid="s" />,
        end: <i data-testid="e" />,
      },
    });
    expect(t.tbIds()).toEqual(['rcm-tb-bold', 'rcm-tb-custom-x']);
    expect(t.container.querySelectorAll('[role="separator"]')).toHaveLength(1);
    expect(t.q('s')).not.toBeNull();
    expect(t.q('e')).not.toBeNull();
    const custom = t.must('rcm-tb-custom-x');
    expect(custom).toHaveAttribute('aria-pressed', 'true');
    expect(custom).toHaveAttribute('aria-label', 'X');
    expect(custom).toHaveAttribute('title', 'X');
    click(custom);
    expect(run).toHaveBeenCalledWith(t.editor);
  });

  it('config: preset + hide and a render() custom item', async () => {
    const t = await mount({
      toolbar: {
        preset: 'simple',
        hide: ['link', 'clearFormat'],
        start: null,
      },
    });
    expect(t.q('rcm-tb-link')).toBeNull();
    expect(t.q('rcm-tb-clearFormat')).toBeNull();
    expect(t.q('rcm-tb-bold')).not.toBeNull();
    cleanup();
    const r = await mount({
      toolbar: {
        items: [{ key: 'r', label: 'R', render: () => <b data-testid="rcm-tb-custom-r" /> }],
      },
    });
    expect(r.tbIds()).toEqual(['rcm-tb-custom-r']);
  });

  it('items whose command is missing (feature disabled) are omitted', async () => {
    const t = await mount({ features: { subscript: false, superscript: false, highlight: false } });
    expect(t.q('rcm-tb-subscript')).toBeNull();
    expect(t.q('rcm-tb-superscript')).toBeNull();
    expect(t.q('rcm-tb-highlight')).toBeNull();
    expect(t.q('rcm-tb-bold')).not.toBeNull();
    // no dangling separators at the edges of the bar
    const bar = t.must('rcm-toolbar');
    expect(bar.firstElementChild?.getAttribute('role')).not.toBe('separator');
    expect(bar.lastElementChild?.getAttribute('role')).not.toBe('separator');
  });
});

describe('labels', () => {
  it('default label keys cover every toolbar item key, none empty', () => {
    const keys = Object.keys(DEFAULT_EDITOR_LABELS);
    for (const key of TOOLBAR_ITEM_KEYS) expect(keys).toContain(key);
    for (const entry of [...TOOLBAR_PRESETS.full, ...TOOLBAR_PRESETS.simple]) {
      if (entry !== '|') expect(keys).toContain(entry);
    }
    for (const key of ['toolbar', 'more']) expect(keys).toContain(key);
    for (const [key, value] of Object.entries(DEFAULT_EDITOR_LABELS)) {
      expect(value, key).not.toBe('');
    }
  });

  it('every toolbar button takes aria-label and title from the injected labels', async () => {
    const labels = Object.fromEntries(
      Object.keys(DEFAULT_EDITOR_LABELS).map((k) => [k, `SENT_${k}`]),
    );
    const t = await mount({ labels });
    const buttons = Array.from(
      t.container.querySelectorAll<HTMLElement>('[data-testid^="rcm-tb-"]'),
    ).filter((el) => el.tagName === 'BUTTON');
    expect(buttons.length).toBeGreaterThan(20);
    for (const b of buttons) {
      const key = (b.dataset.testid as string).replace('rcm-tb-', '');
      expect(b.getAttribute('aria-label')).toBe(`SENT_${key}`);
      expect(b.getAttribute('title')).toBe(`SENT_${key}`);
    }
    expect(t.must('rcm-toolbar').getAttribute('aria-label')).toBe('SENT_toolbar');
  });

  it('partial labels replace only the given keys', async () => {
    const t = await mount({ labels: { bold: 'B!' } });
    expect(t.must('rcm-tb-bold')).toHaveAttribute('aria-label', 'B!');
    expect(t.must('rcm-tb-italic')).toHaveAttribute('aria-label', DEFAULT_EDITOR_LABELS.italic);
  });
});

describe('commands', () => {
  it('toolbar buttons toggle bold/italic/underline/strike/superscript/subscript', async () => {
    const t = await mount({ defaultValue: '<p>abc</p>' });
    selectAll(t.editor);
    for (const key of ['bold', 'italic', 'underline', 'strike', 'superscript']) {
      click(t.must(`rcm-tb-${key}`));
    }
    expect(marksOf(t.editor)).toEqual(['bold', 'italic', 'strike', 'superscript', 'underline']);
    await waitFor(() => expect(t.must('rcm-tb-bold')).toHaveAttribute('aria-pressed', 'true'));
    expect(t.must('rcm-tb-italic')).toHaveAttribute('aria-pressed', 'true');
    expect(t.must('rcm-tb-subscript')).toHaveAttribute('aria-pressed', 'false');
    click(t.must('rcm-tb-bold'));
    click(t.must('rcm-tb-superscript'));
    click(t.must('rcm-tb-subscript'));
    expect(marksOf(t.editor)).toEqual(['italic', 'strike', 'subscript', 'underline']);
    await waitFor(() => expect(t.must('rcm-tb-bold')).toHaveAttribute('aria-pressed', 'false'));
  });

  it('after a command the focus is in the editing area', async () => {
    const t = await mount({ defaultValue: '<p>abc</p>' });
    selectAll(t.editor);
    t.must('rcm-tb-bold').focus();
    click(t.must('rcm-tb-bold'));
    await waitFor(() => expect(document.activeElement).toBe(t.editor.view.dom));
  });

  it('size menu writes "<n>pt" and keeps existing px sizes', async () => {
    const t = await mount({
      defaultValue: '<p><span style="font-size: 14px">abc</span> def</p>',
    });
    t.editor.commands.setTextSelection({ from: 5, to: 8 });
    click(t.must('rcm-tb-fontSize'));
    const options = Array.from(
      t.container.querySelectorAll<HTMLElement>('[data-testid="rcm-tbo-fontSize"]'),
    );
    expect(options.map((o) => o.dataset.value)).toContain('10.5pt');
    click(options.find((o) => o.dataset.value === '12pt') as HTMLElement);
    const json = JSON.stringify(t.editor.getJSON());
    expect(json).toContain('"fontSize":"12pt"');
    expect(json).toContain('"fontSize":"14px"');
    expect(t.editor.getHTML()).toContain('font-size: 14px');
  });

  it('alignment buttons set textAlign', async () => {
    const t = await mount({ defaultValue: '<p>abc</p>' });
    for (const [key, value] of [
      ['alignCenter', 'center'],
      ['alignRight', 'right'],
      ['alignJustify', 'justify'],
      ['alignLeft', 'left'],
    ] as const) {
      click(t.must(`rcm-tb-${key}`));
      expect(t.editor.getJSON().content?.[0]?.attrs?.textAlign).toBe(value);
      await waitFor(() => expect(t.must(`rcm-tb-${key}`)).toHaveAttribute('aria-pressed', 'true'));
    }
  });

  it('clear format removes every mark of the selection', async () => {
    const t = await mount({
      defaultValue:
        '<p><strong><em><u><s><span style="color: #ff0000">abc</span></s></u></em></strong> <a href="https://a.b">x</a></p>',
    });
    expect(marksOf(t.editor).length).toBeGreaterThan(3);
    selectAll(t.editor);
    click(t.must('rcm-tb-clearFormat'));
    const text = JSON.stringify(t.editor.getJSON());
    expect(text).not.toContain('"marks"');
    expect(t.editor.getText()).toBe('abc x');
  });

  it('undo/redo restore the JSON before/after a formatting change', async () => {
    const t = await mount({ defaultValue: '<p>abc</p>' });
    const before = t.editor.getJSON();
    selectAll(t.editor);
    click(t.must('rcm-tb-bold'));
    const after = t.editor.getJSON();
    expect(after).not.toEqual(before);
    await waitFor(() => expect(t.must('rcm-tb-undo')).not.toBeDisabled());
    expect(t.must('rcm-tb-redo')).toBeDisabled();
    click(t.must('rcm-tb-undo'));
    expect(t.editor.getJSON()).toEqual(before);
    await waitFor(() => expect(t.must('rcm-tb-redo')).not.toBeDisabled());
    click(t.must('rcm-tb-redo'));
    expect(t.editor.getJSON()).toEqual(after);
  });

  it('font menu: default entry unsets, fonts prop replaces the built-in list', async () => {
    const fonts = [{ label: 'Alpha', value: "'Alpha', serif" }];
    const t = await mount({ defaultValue: '<p>abc</p>', fonts });
    selectAll(t.editor);
    click(t.must('rcm-tb-fontFamily'));
    const opts = () =>
      Array.from(t.container.querySelectorAll<HTMLElement>('[data-testid="rcm-tbo-fontFamily"]'));
    expect(opts().map((o) => o.dataset.value)).toEqual(['', "'Alpha', serif"]);
    click(opts()[1] as HTMLElement);
    expect(JSON.stringify(t.editor.getJSON())).toContain(`"fontFamily":"'Alpha', serif"`);
    click(t.must('rcm-tb-fontFamily'));
    click(opts()[0] as HTMLElement);
    expect(JSON.stringify(t.editor.getJSON())).not.toContain('fontFamily":"');
  });

  it('font menu defaults to the built-in OFL list', async () => {
    const t = await mount();
    click(t.must('rcm-tb-fontFamily'));
    const values = Array.from(
      t.container.querySelectorAll<HTMLElement>('[data-testid="rcm-tbo-fontFamily"]'),
    ).map((o) => o.dataset.value);
    expect(values).toEqual(['', ...DEFAULT_FONTS.map((f) => f.value)]);
  });

  it('line spacing menu sets the paragraph lineHeight', async () => {
    const t = await mount({ defaultValue: '<p>abc</p>' });
    click(t.must('rcm-tb-lineHeight'));
    const opt = t.container.querySelector<HTMLElement>(
      '[data-testid="rcm-tbo-lineHeight"][data-value="1.5"]',
    );
    click(opt as HTMLElement);
    expect(t.editor.getJSON().content?.[0]?.attrs?.lineHeight).toBe('1.5');
  });

  it('heading menu offers 본문 and 제목 1–3; the selection writes and clears the level', async () => {
    const t = await mount({ defaultValue: '<p>abc</p>' });
    selectAll(t.editor);
    click(t.must('rcm-tb-heading'));
    const opts = () =>
      Array.from(t.container.querySelectorAll<HTMLElement>('[data-testid="rcm-tbo-heading"]'));
    expect(opts().map((o) => o.dataset.value)).toEqual(['', '1', '2', '3']);
    expect(opts()[0]).toHaveAttribute('aria-checked', 'true');
    const trigger = () =>
      t.must('rcm-tb-heading').querySelector<HTMLElement>('.rcm-tb-menu-text')?.dataset.value;
    expect(trigger()).toBe(DEFAULT_EDITOR_LABELS.paragraph);
    click(opts().find((o) => o.dataset.value === '2') as HTMLElement);
    const block = () => t.editor.getJSON().content?.[0];
    expect(block()?.type).toBe('heading');
    expect(block()?.attrs?.level).toBe(2);
    await waitFor(() => expect(trigger()).toBe(DEFAULT_EDITOR_LABELS.heading2));
    click(t.must('rcm-tb-heading'));
    click(opts()[0] as HTMLElement);
    expect(block()?.type).toBe('paragraph');
    await waitFor(() => expect(trigger()).toBe(DEFAULT_EDITOR_LABELS.paragraph));
  });

  it('code toggles the inline code mark like bold', async () => {
    const t = await mount({ defaultValue: '<p>abc</p>' });
    selectAll(t.editor);
    click(t.must('rcm-tb-code'));
    expect(marksOf(t.editor)).toEqual(['code']);
    await waitFor(() => expect(t.must('rcm-tb-code')).toHaveAttribute('aria-pressed', 'true'));
    click(t.must('rcm-tb-code'));
    expect(marksOf(t.editor)).toEqual([]);
    await waitFor(() => expect(t.must('rcm-tb-code')).toHaveAttribute('aria-pressed', 'false'));
  });

  it('taskList and codeBlock toggle their blocks', async () => {
    const t = await mount({ defaultValue: '<p>abc</p>' });
    selectAll(t.editor);
    click(t.must('rcm-tb-taskList'));
    await waitFor(() => expect(t.must('rcm-tb-taskList')).toHaveAttribute('aria-pressed', 'true'));
    expect(t.editor.isActive('taskList')).toBe(true);
    click(t.must('rcm-tb-taskList'));
    await waitFor(() => expect(t.must('rcm-tb-taskList')).toHaveAttribute('aria-pressed', 'false'));
    expect(t.editor.isActive('taskList')).toBe(false);

    selectAll(t.editor);
    click(t.must('rcm-tb-codeBlock'));
    await waitFor(() => expect(t.must('rcm-tb-codeBlock')).toHaveAttribute('aria-pressed', 'true'));
    expect(t.editor.getJSON().content?.[0]?.type).toBe('codeBlock');
    expect(t.editor.getText()).toContain('abc');
  });

  it('youtube popover inserts a youtube node; empty or non-YouTube input does nothing', async () => {
    const t = await mount({ defaultValue: '<p>abc</p>' });
    selectAll(t.editor);
    click(t.must('rcm-tb-youtube'));
    const panel = () => t.container.querySelector('.rcm-tb-panel');
    expect(panel()).not.toBeNull();
    const input = t.must('rcm-tbo-youtube-url') as HTMLInputElement;
    // Empty input: no node, the popover stays open.
    click(t.must('rcm-tbo-youtube-apply'));
    expect(panel()).not.toBeNull();
    expect(t.editor.getJSON().content?.[0]?.type).toBe('paragraph');
    // Non-YouTube URL: the command refuses, the popover stays open.
    act(() => void fireEvent.change(input, { target: { value: 'https://example.com/x' } }));
    click(t.must('rcm-tbo-youtube-apply'));
    expect(panel()).not.toBeNull();
    expect(t.editor.getJSON().content?.[0]?.type).toBe('paragraph');
    // A YouTube URL replaces the selection with the embed and closes the popover.
    act(
      () =>
        void fireEvent.change(input, {
          target: { value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
        }),
    );
    click(t.must('rcm-tbo-youtube-apply'));
    expect(JSON.stringify(t.editor.getJSON())).toContain('"type":"youtube"');
    await waitFor(() => expect(panel()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(t.editor.view.dom));
  });

  it('colours are stored as lowercase #rrggbb (palette and custom input)', async () => {
    const t = await mount({ defaultValue: '<p>abc</p>' });
    selectAll(t.editor);
    click(t.must('rcm-tb-color'));
    const swatches = t.container.querySelectorAll<HTMLElement>(
      '[data-testid="rcm-tbo-color-swatch"]',
    );
    expect(swatches.length).toBeGreaterThanOrEqual(16);
    for (const s of Array.from(swatches)) expect(s.dataset.value).toMatch(/^#[0-9a-f]{6}$/);
    click(swatches[6] as HTMLElement);
    expect(JSON.stringify(t.editor.getJSON())).toContain(`"color":"${swatches[6]?.dataset.value}"`);

    click(t.must('rcm-tb-highlight'));
    const input = t.must('rcm-tbo-highlight-custom') as HTMLInputElement;
    act(() => void fireEvent.change(input, { target: { value: '#FFCC00' } }));
    expect(JSON.stringify(t.editor.getJSON())).toContain('"highlight","attrs":{"color":"#ffcc00"}');
    click(t.must('rcm-tbo-highlight-remove'));
    expect(JSON.stringify(t.editor.getJSON())).not.toContain('highlight');
  });

  it('link popover applies and removes a link without window.prompt', async () => {
    const prompt = vi.spyOn(window, 'prompt');
    const t = await mount({ defaultValue: '<p>abc</p>' });
    selectAll(t.editor);
    click(t.must('rcm-tb-link'));
    const input = t.must('rcm-tbo-link-url') as HTMLInputElement;
    act(() => void fireEvent.change(input, { target: { value: 'https://example.com/a' } }));
    click(t.must('rcm-tbo-link-apply'));
    expect(t.editor.getHTML()).toContain('href="https://example.com/a"');
    await waitFor(() => expect(t.must('rcm-tb-link')).toHaveAttribute('data-active'));
    click(t.must('rcm-tb-link'));
    click(t.must('rcm-tbo-link-remove'));
    expect(t.editor.getHTML()).not.toContain('<a');
    expect(prompt).not.toHaveBeenCalled();
  });
});

describe('keyboard', () => {
  it('roving tabindex: one Tab stop, arrows/Home/End move focus', async () => {
    const t = await mount();
    const ctls = () =>
      Array.from(t.container.querySelectorAll<HTMLElement>('[data-rcm-ctl]')).filter(
        (el) => !(el as HTMLButtonElement).disabled,
      );
    expect(ctls().filter((el) => el.tabIndex === 0)).toHaveLength(1);
    const first = ctls()[0] as HTMLElement;
    first.focus();
    act(() => void fireEvent.keyDown(first, { key: 'ArrowRight' }));
    expect(document.activeElement).toBe(ctls()[1]);
    expect(ctls().filter((el) => el.tabIndex === 0)).toEqual([ctls()[1]]);
    act(() => void fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'End' }));
    expect(document.activeElement).toBe(ctls()[ctls().length - 1]);
    act(() => void fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' }));
    expect(document.activeElement).toBe(ctls()[0]);
    act(() => void fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowLeft' }));
    expect(document.activeElement).toBe(ctls()[ctls().length - 1]);
  });

  it('menus and popovers expose haspopup/expanded and close on Esc into the editor', async () => {
    const t = await mount();
    for (const key of ['fontFamily', 'color', 'link', 'youtube']) {
      const trigger = t.must(`rcm-tb-${key}`);
      expect(trigger).toHaveAttribute('aria-haspopup');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const panel = t.container.querySelector('.rcm-tb-panel') as HTMLElement;
      expect(['menu', 'dialog']).toContain(panel.getAttribute('role'));
      act(() => void fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' }));
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(t.container.querySelector('.rcm-tb-panel')).toBeNull();
      await waitFor(() => expect(document.activeElement).toBe(t.editor.view.dom));
    }
  });

  it('font menu items are menuitemradio with the current font checked; arrows move focus', async () => {
    const t = await mount({ defaultValue: '<p>abc</p>' });
    click(t.must('rcm-tb-fontFamily'));
    const items = Array.from(t.container.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));
    expect(items.length).toBe(1 + DEFAULT_FONTS.length);
    expect(items[0]).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(items[0]);
    act(() => void fireEvent.keyDown(items[0] as HTMLElement, { key: 'ArrowDown' }));
    expect(document.activeElement).toBe(items[1]);
  });
});

describe('overflow', () => {
  it('without layout (jsdom) every item stays on the bar and there is no more button', async () => {
    const t = await mount();
    expect(t.q('rcm-tb-more')).toBeNull();
  });
});
