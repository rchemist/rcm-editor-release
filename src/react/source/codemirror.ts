// Lazy CodeMirror 6 bundle for HTML source editing.
//
// The whole editor sits behind one set of dynamic `import()`s, so no CodeMirror code is
// downloaded (or bundled) until the first source-mode entry; `@codemirror/*` and `@lezer/*`
// are externals of the dist build, consumer bundlers split the chunk.
// `loadCodeMirror()` caches its promise — one load ever per page — and tests spy on this
// function to prove nothing loads before the first entry.
import type { EditorView } from '@codemirror/view';

export interface SourceEditorHandle {
  /** The CodeMirror view (tests type through `view.dispatch({ changes })`). */
  view: EditorView;
  destroy(): void;
}

export interface CreateSourceEditorOptions {
  parent: HTMLElement;
  /** Initial document text — verbatim, never pretty-printed (byte preservation). */
  doc: string;
  /** Accessible name of the contenteditable. */
  ariaLabel: string;
  /** Called with the full text on every document change. */
  onChange: (doc: string) => void;
}

export interface CodeMirrorApi {
  createSourceEditor(options: CreateSourceEditorOptions): SourceEditorHandle;
}

let pending: Promise<CodeMirrorApi> | null = null;

/** Loads CodeMirror 6 on demand (first source-mode / raw-fragment editor entry). */
export function loadCodeMirror(): Promise<CodeMirrorApi> {
  pending ??= (async () => {
    const [
      { EditorView, keymap, lineNumbers },
      { HighlightStyle, indentUnit, syntaxHighlighting },
      { defaultKeymap, history, historyKeymap, indentWithTab },
      { search, searchKeymap },
      { html },
      { tags },
    ] = await Promise.all([
      import('@codemirror/view'),
      import('@codemirror/language'),
      import('@codemirror/commands'),
      import('@codemirror/search'),
      import('@codemirror/lang-html'),
      import('@lezer/highlight'),
    ]);

    // Token colours are CSS variables, so dark mode is just the token swap in tokens.css.
    const highlight = HighlightStyle.define([
      { tag: tags.tagName, color: 'var(--rcm-editor-cm-tag)' },
      { tag: tags.angleBracket, color: 'var(--rcm-editor-cm-bracket)' },
      { tag: tags.attributeName, color: 'var(--rcm-editor-cm-attr)' },
      { tag: [tags.attributeValue, tags.string], color: 'var(--rcm-editor-cm-string)' },
      { tag: tags.comment, color: 'var(--rcm-editor-cm-comment)', fontStyle: 'italic' },
      { tag: tags.keyword, color: 'var(--rcm-editor-cm-attr)' },
      { tag: tags.number, color: 'var(--rcm-editor-cm-string)' },
    ]);

    return {
      createSourceEditor({ parent, doc, ariaLabel, onChange }: CreateSourceEditorOptions) {
        const view = new EditorView({
          parent,
          doc,
          extensions: [
            lineNumbers(),
            history(),
            keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
            indentUnit.of('  '),
            search({ top: true }),
            html(),
            syntaxHighlighting(highlight),
            EditorView.lineWrapping,
            EditorView.contentAttributes.of({ 'aria-label': ariaLabel, spellcheck: 'false' }),
            EditorView.updateListener.of((update) => {
              if (update.docChanged) onChange(update.state.doc.toString());
            }),
          ],
        });
        return { view, destroy: () => view.destroy() };
      },
    };
  })();
  return pending;
}
