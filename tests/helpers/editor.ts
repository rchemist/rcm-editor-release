import { Editor } from '@tiptap/core';
import type { Content } from '@tiptap/core';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CreateEditorExtensionsOptions } from '../../src/index';
import { createEditorExtensions } from '../../src/index';

const editors: Editor[] = [];

/** Headless editor with the full kit; destroyed by `destroyEditors()` (afterEach). */
export function makeEditor(content: Content, options?: CreateEditorExtensionsOptions): Editor {
  const editor = new Editor({ extensions: createEditorExtensions(options), content });
  editors.push(editor);
  return editor;
}

export function destroyEditors(): void {
  while (editors.length) editors.pop()?.destroy();
}

/** Simulates a keydown through the editor's keymap plugins; returns whether it was handled. */
export function pressKey(editor: Editor, key: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  return editor.view.someProp('handleKeyDown', (f) => f(editor.view, event)) ?? false;
}

export interface DocparserFixture {
  name: string;
  doc: Record<string, unknown>;
}

const FIXTURE_DIR = join(__dirname, '..', '..', 'fixtures', 'docparser');

function loadFrom(dir: string, prefix = ''): DocparserFixture[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({
      name: prefix + f.replace(/\.json$/, ''),
      doc: (JSON.parse(readFileSync(join(dir, f), 'utf8')) as { doc: Record<string, unknown> }).doc,
    }));
}

/** Default (profile-less) docparser fixtures. */
export function loadFixtures(): DocparserFixture[] {
  return loadFrom(FIXTURE_DIR);
}

/** `profile: "rcm-editor"` renders of the same sources (named `profile/<slug>`). */
export function loadProfileFixtures(): DocparserFixture[] {
  return loadFrom(join(FIXTURE_DIR, 'profile'), 'profile/');
}
