import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Editor, Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import {
  TIPTAP_DUPLICATE_CODE,
  TIPTAP_VERSION,
  createEditorExtensions,
  detectTiptapDuplicates,
  formatTiptapDuplicateWarning,
} from '../src/index';
import { loadDuplicate } from './helpers/duplicate';

const require = createRequire(import.meta.url);

describe('tiptap duplicate detection (headless core)', () => {
  it('TIPTAP_VERSION equals the @tiptap/core version we build against', () => {
    const installed = JSON.parse(
      readFileSync(join(dirname(require.resolve('@tiptap/core')), '..', 'package.json'), 'utf8'),
    ).version;
    expect(TIPTAP_VERSION).toBe(installed);
  });

  it('single install: no findings for defaults, consumer extension and raw plugin', () => {
    const raw = new Plugin({ key: new PluginKey('consumerRaw') });
    const extensions = [
      ...createEditorExtensions(),
      Extension.create({ name: 'consumerRaw', addProseMirrorPlugins: () => [raw] }),
    ];
    expect(detectTiptapDuplicates(extensions)).toEqual([]);
    const editor = new Editor({ extensions });
    try {
      expect(detectTiptapDuplicates(editor)).toEqual([]);
    } finally {
      editor.destroy();
    }
  });

  it('flags an extension created by another @tiptap/core instance', async () => {
    const dupCore = await loadDuplicate<typeof import('@tiptap/core')>('@tiptap/core');
    expect(dupCore.Extension).not.toBe(Extension);
    const foreign = dupCore.Extension.create({ name: 'foreignExt' });
    expect(detectTiptapDuplicates([...createEditorExtensions(), foreign])).toEqual([
      { kind: 'extension', name: 'foreignExt' },
    ]);
  });

  it('flags a ProseMirror plugin created by another @tiptap/pm instance', async () => {
    const dupState = await loadDuplicate<typeof import('@tiptap/pm/state')>('@tiptap/pm/state');
    expect(dupState.Plugin).not.toBe(Plugin);
    const foreign = new dupState.Plugin({ key: new dupState.PluginKey('foreignPlugin') });
    const editor = new Editor({
      extensions: [
        ...createEditorExtensions(),
        Extension.create({ name: 'carrier', addProseMirrorPlugins: () => [foreign as Plugin] }),
      ],
    });
    try {
      const findings = detectTiptapDuplicates(editor);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.kind).toBe('plugin');
      expect(findings[0]?.name).toMatch(/^foreignPlugin\$/);
    } finally {
      editor.destroy();
    }
  });

  it('warning text carries the code and the version to align to', () => {
    const text = formatTiptapDuplicateWarning([{ kind: 'extension', name: 'x' }]);
    expect(text.startsWith(`[${TIPTAP_DUPLICATE_CODE}]`)).toBe(true);
    expect(text).toContain(TIPTAP_VERSION);
  });
});
