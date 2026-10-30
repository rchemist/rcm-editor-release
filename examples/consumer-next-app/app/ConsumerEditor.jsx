'use client';

import { useState } from 'react';
import { RcmEditor } from '@rchemist/editor/react';
import { Extension } from '@tiptap/core';
import Highlight from '@tiptap/extension-highlight';
import { Plugin, PluginKey } from '@tiptap/pm/state';

// Raw ProseMirror plugin: counts doc-changing transactions and exposes them as DOM attributes.
const probeKey = new PluginKey('consumerProbe');
const ProbeExtension = Extension.create({
  name: 'consumerProbe',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: probeKey,
        state: { init: () => 0, apply: (tr, n) => (tr.docChanged ? n + 1 : n) },
        props: {
          attributes: (state) => ({
            'data-consumer-pm-plugin': 'active',
            'data-consumer-pm-tx': String(probeKey.getState(state)),
          }),
        },
      }),
    ];
  },
});

const extensions = [Highlight, ProbeExtension];
const editorProps = { attributes: { 'data-testid': 'consumer-editor' } };

export function ConsumerEditor() {
  const [editor, setEditor] = useState(null);
  const [json, setJson] = useState('');
  return (
    <section data-testid="extended">
      <button
        type="button"
        data-testid="consumer-highlight"
        onClick={() => editor?.chain().focus().selectAll().toggleHighlight().run()}
      >
        H
      </button>
      <RcmEditor
        extensions={extensions}
        editorProps={editorProps}
        onReady={setEditor}
        onChange={(change) => setJson(JSON.stringify(change.json))}
      />
      <pre data-testid="consumer-json">{json}</pre>
    </section>
  );
}
