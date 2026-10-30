import type { JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { destroyEditors, loadFixtures, loadProfileFixtures, makeEditor } from '../helpers/editor';
import { getContentReport } from '../../src/index';

afterEach(destroyEditors);

const gate = [...loadFixtures(), ...loadProfileFixtures()].map((f) => ({
  name: f.name,
  doc: f.doc as JSONContent,
}));

function docTypes(doc: JSONContent): string[] {
  const out: string[] = [];
  const walk = (node: JSONContent) => {
    if (node.type) out.push(node.type);
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return out;
}

describe('docparser fixtures: JSON loads are unaffected', () => {
  it.each(gate.map((f) => [f.name] as [string]))('%s loads as JSON without rawHtml', (name) => {
    const fixture = gate.find((f) => f.name === name)!;
    const editor = makeEditor(fixture.doc);
    expect(docTypes(editor.getJSON()), name).not.toContain('rawHtml');
  });
});

describe('own getHTML output', () => {
  it.each(gate.map((f) => [f.name] as [string]))(
    '%s getHTML reloads with zero rawHtml blocks',
    (name) => {
      const fixture = gate.find((f) => f.name === name)!;
      const html = makeEditor(fixture.doc).getHTML();
      // A clean load emits no report at all; read the document itself instead.
      const back = makeEditor(html);
      expect(docTypes(back.getJSON()), name).not.toContain('rawHtml');
      expect(getContentReport(back)?.rawHtml ?? [], name).toEqual([]);
      expect(getContentReport(back)?.unknownHtml ?? [], name).toEqual([]);
    },
    30000,
  );
});
