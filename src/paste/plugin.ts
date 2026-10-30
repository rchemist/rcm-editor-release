// Paste normalizer plugin: runs before the guard's policy plugin and reports drops.
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { emitContentReport, htmlPolicyOf } from '../guard/contentGuard';
import { normalizePastedHtml } from './normalize';

export const PASTE_NORMALIZER_KEY = 'rcmPasteNormalizer';

/**
 * `paste` feature (core, default on): schema-aware paste normalization as a ProseMirror
 * `transformPastedHTML` plugin prop. Plugin props run in registration order (direct
 * `editorProps` first, then each plugin's), and this extension is registered before the
 * content guard — so the normalizer runs before `pastePolicyPlugin`, and the policy stays
 * the last word. Anything dropped is reported through the existing `onContentReport`
 * channel (`source: 'insertContent'`, `format: 'html'`) with the entries in `unknownHtml`.
 * `features.paste: false` disables it (paste falls through to ProseMirror defaults).
 */
export const PasteNormalizer = Extension.create({
  // Not 'paste': tiptap core ships an extension of that name (paste events).
  name: 'rcmPaste',
  // ProseMirror chains `transformPastedHTML` in plugin order, and tiptap assembles plugins in
  // reverse extension order (stable sort by priority, default 100): without a higher priority
  // this plugin would run after the guard's policy plugin. The extension contributes no
  // nodes, marks, attributes or commands, so the priority only moves this plugin first.
  priority: 101,

  addProseMirrorPlugins() {
    const editor = this.editor;
    // Set by `transformPastedHTML` for the paste in flight and consumed (reset) by
    // `transformPasted`: external HTML arrives without `data-pm-slice`, so ProseMirror opened
    // its edges with `Slice.maxOpen` — a pasted paragraph then merges into the host paragraph
    // and loses its own attributes. Internal copies keep
    // their recorded openness and must not be closed.
    let externalHtmlPaste = false;
    return [
      new Plugin({
        key: new PluginKey(PASTE_NORMALIZER_KEY),
        props: {
          transformPastedHTML(html: string): string {
            externalHtmlPaste = !html.includes('data-pm-slice');
            if (editor.isDestroyed) return html;
            let normalized: ReturnType<typeof normalizePastedHtml>;
            try {
              normalized = normalizePastedHtml(html, {
                schema: editor.schema,
                ...htmlPolicyOf(editor),
              });
            } catch {
              return html;
            }
            if (normalized.dropped.length) {
              emitContentReport(editor, {
                source: 'insertContent',
                format: 'html',
                unsupported: [],
                unknownHtml: normalized.dropped.map((entry) => ({
                  tag: entry.tag,
                  html: entry.html,
                  reason: 'ignored' as const,
                })),
                rawHtml: [],
                policyRemoved: [],
              });
            }
            return normalized.html;
          },
          transformPasted(slice: Slice, view: EditorView): Slice {
            const external = externalHtmlPaste;
            externalHtmlPaste = false;
            if (!external) return slice;
            // A single pasted paragraph into text merges inline (a partial copy from Word still
            // arrives wrapped in `<p class=MsoNormal>`; splitting the host for one word would be
            // wrong). Several blocks, or an empty host paragraph, keep their own paragraphs.
            const hostEmpty = view.state.selection.$from.parent.content.size === 0;
            if (slice.content.childCount < 2 && !hostEmpty) return slice;
            return closeExternalTextblockEdges(slice);
          },
        },
      }),
    ];
  },
});

/**
 * Close the synthetic edge openness of an external-HTML paste when the edge node is a
 * textblock (paragraph/heading — none of this schema's textblocks require content, so the
 * closed node is valid as-is): the pasted paragraphs then land as their own nodes, keeping
 * lineHeight/indent/margins, instead of merging into the host paragraph. Deeper structures
 * (lists, tables, isolating nodes) keep ProseMirror's fitting behaviour.
 */
function closeExternalTextblockEdges(slice: Slice): Slice {
  const closable = (node: PMNode | null | undefined): boolean =>
    !!node && node.isTextblock && !node.type.spec.isolating && !node.type.spec.code;
  const openStart = slice.openStart > 0 && closable(slice.content.firstChild) ? 0 : slice.openStart;
  const openEnd = slice.openEnd > 0 && closable(slice.content.lastChild) ? 0 : slice.openEnd;
  if (openStart === slice.openStart && openEnd === slice.openEnd) return slice;
  return new Slice(slice.content, openStart, openEnd);
}
