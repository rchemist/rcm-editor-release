import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountEditor } from '../../src/vanilla';
import type { MountedEditor } from '../../src/vanilla';

const mounted: MountedEditor[] = [];

function mount(options: Parameters<typeof mountEditor>[1] = {}) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const m = mountEditor(el, options);
  mounted.push(m);
  return { el, m };
}

afterEach(() => {
  mounted.splice(0).forEach((m) => m.destroy());
  document.body.innerHTML = '';
});

describe('mountEditor', () => {
  it('returns a live editor synchronously with lossless getJSON/getHTML', () => {
    const { el, m } = mount({ defaultValue: '<p>hi</p>' });
    expect(m.editor.getText()).toBe('hi');
    expect(m.getHTML()).toBe('<p>hi</p>');
    expect(m.getJSON().content?.[0]?.content?.[0]?.text).toBe('hi');
    expect(el.querySelector('[data-rcm-editor] [contenteditable="true"]')).not.toBeNull();
  });

  it('typing notifies onChange; setContent replaces without notifying', () => {
    const onChange = vi.fn();
    const { m } = mount({ onChange, changeDebounceMs: 0 });
    m.editor.commands.insertContent('a');
    expect(onChange.mock.calls.at(-1)?.[0].html).toBe('<p>a</p>');
    const calls = onChange.mock.calls.length;
    m.setContent('<p>b</p>');
    expect(m.getHTML()).toBe('<p>b</p>');
    expect(onChange).toHaveBeenCalledTimes(calls);
  });

  it('setReadonly toggles editability; setContent still works while read-only', () => {
    const { el, m } = mount({ defaultValue: '<p>x</p>' });
    m.setReadonly(true);
    expect(m.editor.isEditable).toBe(false);
    expect(el.querySelector('[contenteditable="true"]')).toBeNull();
    m.editor.commands.insertContent('y');
    expect(m.getHTML()).toBe('<p>x</p>');
    m.setContent('<p>z</p>');
    expect(m.getHTML()).toBe('<p>z</p>');
    m.setReadonly(false);
    expect(m.editor.isEditable).toBe(true);
  });

  it('update() merges options (minHeight, labels)', () => {
    const { el, m } = mount();
    m.update({ minHeight: 300, labels: { editorArea: '__area__' } });
    const root = el.querySelector<HTMLElement>('[data-rcm-editor]')!;
    expect(root.style.getPropertyValue('--rcm-editor-min-height')).toBe('300px');
    expect(el.querySelector('[role="textbox"]')).toHaveAttribute('aria-label', '__area__');
  });

  it('destroy flushes the pending change, empties the element, destroys the editor and is idempotent', () => {
    const onChange = vi.fn();
    const { el, m } = mount({ onChange, changeDebounceMs: 10_000 });
    const editor = m.editor;
    editor.commands.insertContent('last');
    m.destroy();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].html).toBe('<p>last</p>');
    expect(el.childElementCount).toBe(0);
    expect(editor.isDestroyed).toBe(true);
    expect(() => m.getHTML()).toThrow();
    expect(() => m.destroy()).not.toThrow();
  });
});
