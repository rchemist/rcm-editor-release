import { describe, expect, it, vi } from 'vitest';

// Any attempt to load React from the core entry fails the import below.
vi.mock('react', () => {
  throw new Error('core entry must not load react');
});
vi.mock('react-dom', () => {
  throw new Error('core entry must not load react-dom');
});

describe('core entry', () => {
  it('imports and builds a headless editor without React', async () => {
    const { Editor } = await import('@tiptap/core');
    const { createEditorExtensions } = await import('../../src/index');
    const editor = new Editor({
      extensions: createEditorExtensions(),
      content: '<p style="line-height: 1.6">a</p>',
    });
    editor.commands.selectAll();
    editor.commands.indent();
    expect(editor.getJSON().content?.[0]?.attrs).toMatchObject({
      lineHeight: '1.6',
      marginLeft: '10pt',
    });
    editor.destroy();
  });
});
