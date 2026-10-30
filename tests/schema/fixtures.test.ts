import { afterEach, describe, expect, it } from 'vitest';
import type { Schema } from '@tiptap/pm/model';
import { diffDocs, formatDifferences } from '../helpers/json-equal';
import { destroyEditors, loadFixtures, makeEditor } from '../helpers/editor';

type JsonNode = {
  type: string;
  attrs?: Record<string, unknown>;
  marks?: JsonNode[];
  content?: JsonNode[];
};

/** Node/mark types and attributes in `doc` that `schema` does not know. */
function schemaGaps(doc: JsonNode, schema: Schema): string[] {
  const gaps = new Set<string>();
  const attrs = (type: string, known: Record<string, unknown>, a?: object) => {
    for (const k of Object.keys(a ?? {})) if (!(k in known)) gaps.add(`attr:${type}.${k}`);
  };
  const walk = (n: JsonNode) => {
    const nodeType = schema.nodes[n.type];
    if (!nodeType) gaps.add(`node:${n.type}`);
    else attrs(n.type, nodeType.spec.attrs ?? {}, n.attrs);
    for (const m of n.marks ?? []) {
      const markType = schema.marks[m.type];
      if (!markType) gaps.add(`mark:${m.type}`);
      else attrs(m.type, markType.spec.attrs ?? {}, m.attrs);
    }
    n.content?.forEach(walk);
  };
  walk(doc);
  return [...gaps].sort();
}

afterEach(destroyEditors);

describe('docparser fixtures → createEditorExtensions() → getJSON()', () => {
  for (const { name, doc } of loadFixtures()) {
    it(`${name}: every node, mark and attribute is in the schema`, () => {
      const editor = makeEditor('');
      expect(schemaGaps(doc as JsonNode, editor.schema)).toEqual([]);
    });

    it(`${name}: lossless`, () => {
      const editor = makeEditor(doc);
      const diffs = diffDocs(doc, editor.getJSON());
      expect(diffs, formatDifferences(diffs)).toEqual([]);
    });
  }
});
