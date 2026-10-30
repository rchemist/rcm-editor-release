import { afterEach, describe, expect, it } from 'vitest';
import { Mark } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createEditorExtensions,
  diagnoseRoundtrip,
  diffStructure,
  formatRoundtripDiffs,
  getContentReport,
  getLosslessJSON,
  scanUnknownHtml,
} from '../../src/index';
import { destroyEditors, loadFixtures, loadProfileFixtures, makeEditor } from '../helpers/editor';

afterEach(destroyEditors);

const readLarge = (...path: string[]) =>
  JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'fixtures', 'docparser-large', ...path), 'utf8'),
  ) as { doc: JSONContent };
const LARGE = readLarge('large.json');
const LARGE_PROFILE = readLarge('profile', 'large.json');

const gate = [
  ...loadFixtures().map((f) => ({ name: f.name, doc: f.doc as JSONContent })),
  ...loadProfileFixtures().map((f) => ({ name: f.name, doc: f.doc as JSONContent })),
  { name: 'docparser-large', doc: LARGE.doc },
  { name: 'profile/docparser-large', doc: LARGE_PROFILE.doc },
  {
    // links keep exactly their attributes (no default target/rel/class added)
    name: 'links',
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'btn',
              marks: [{ type: 'link', attrs: { href: '/x', class: 'btn' } }],
            },
            { type: 'text', text: ' ' },
            {
              type: 'text',
              text: 'ext',
              marks: [
                {
                  type: 'link',
                  attrs: { href: 'https://example.com/', target: '_blank', rel: 'noopener' },
                },
              ],
            },
          ],
        },
      ],
    } as JSONContent,
  },
];

describe('round-trip gate: every docparser fixture', () => {
  const extensions = createEditorExtensions();

  for (const { name, doc } of gate) {
    it(`${name}: JSON → editor → JSON lossless, nothing wrapped`, () => {
      const result = diagnoseRoundtrip(doc, extensions);
      expect(result.diffs, formatRoundtripDiffs(result.diffs)).toEqual([]);
      expect(result.lossless).toBe(true);
      expect(result.unsupported).toEqual([]);
    });

    it(
      `${name}: JSON → HTML → JSON lossless`,
      () => {
        const result = diagnoseRoundtrip(doc, extensions, { via: 'html' });
        expect(result.diffs, formatRoundtripDiffs(result.diffs)).toEqual([]);
        expect(result.unsupported).toEqual([]);
      },
      // ~600-block fixtures: CPU-bound HTML load (policy + preservation) on the 2-vCPU CI
      // runner exceeds the 5 s default; the load-time budget itself is measured separately.
      name.includes('large') ? 20_000 : undefined,
    );

    it(`${name}: setContent into a live editor is lossless (tables not normalised on load)`, () => {
      const editor = makeEditor('<p></p>');
      expect(editor.commands.setContent(doc)).toBe(true);
      const diffs = diffStructure(doc, getLosslessJSON(editor));
      expect(diffs, formatRoundtripDiffs(diffs)).toEqual([]);
    });

    it(`${name}: our own HTML output has no element the parser does not know (unknown-HTML diagnostic)`, () => {
      const editor = makeEditor(doc);
      expect(scanUnknownHtml(editor.getHTML(), editor.schema)).toEqual([]);
    });
  }

  it('HTML links come back unchanged: no default target/rel added', () => {
    for (const html of [
      '<p><a class="btn" href="/x">l</a></p>',
      '<p><a target="_blank" rel="noopener" href="https://example.com/">l</a></p>',
    ])
      expect(makeEditor(html).getHTML()).toBe(html);
  });

  it('profile set contains pageBreak and figure/figcaption, all kept by the editor', () => {
    const seen = new Set<string>();
    const walk = (n: JSONContent) => {
      seen.add(n.type ?? '');
      n.content?.forEach(walk);
    };
    for (const f of loadProfileFixtures()) walk(f.doc as JSONContent);
    expect([...seen]).toEqual(expect.arrayContaining(['pageBreak', 'figure', 'figcaption']));
    const editor = makeEditor(
      loadProfileFixtures().find((f) => f.name === 'profile/synthetic-profile')!.doc as JSONContent,
    );
    const types = new Set<string>();
    editor.state.doc.descendants((n) => {
      types.add(n.type.name);
    });
    expect([...types]).toEqual(expect.arrayContaining(['pageBreak', 'figure', 'figcaption']));
  });

  it('profile .2 set contains lists, table.* and image.align, all kept by the editor', () => {
    const attrs = new Map<string, Record<string, unknown>[]>();
    const walk = (n: JSONContent) => {
      const list = attrs.get(n.type ?? '') ?? [];
      list.push(n.attrs ?? {});
      attrs.set(n.type ?? '', list);
      n.content?.forEach(walk);
    };
    const profile = loadProfileFixtures().find((f) => f.name === 'profile/rcm-structures')!;
    walk(profile.doc as JSONContent);
    walk(LARGE_PROFILE.doc);
    expect([...attrs.keys()]).toEqual(
      expect.arrayContaining(['bulletList', 'orderedList', 'listItem']),
    );
    expect(attrs.get('orderedList')).toEqual(expect.arrayContaining([{ start: 3 }]));
    expect(attrs.get('table')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ width: 300, align: 'center', border: expect.any(String) }),
      ]),
    );
    expect(attrs.get('image')!.map((a) => a.align)).toEqual(
      expect.arrayContaining(['inline', 'center', 'right']),
    );
    // The same attributes come out of a live editor unchanged.
    const editor = makeEditor(profile.doc as JSONContent);
    const out = getLosslessJSON(editor);
    expect(diffStructure(profile.doc, out)).toEqual([]);
    const types = new Set<string>();
    editor.state.doc.descendants((n) => {
      types.add(n.type.name);
    });
    expect([...types]).toEqual(expect.arrayContaining(['bulletList', 'orderedList', 'listItem']));
  });

  it('docparser-large: merged tables keep their logical column count after load', () => {
    const editor = makeEditor(LARGE.doc);
    expect(getContentReport(editor)?.unsupported).toEqual([]);
    editor.state.doc.descendants((node) => {
      if (node.type.name !== 'table') return true;
      const widths: number[] = [];
      const pending: number[] = [];
      node.forEach((row, _o, r) => {
        let w = pending[r] ?? 0;
        row.forEach((c) => {
          const span = Number(c.attrs.colspan ?? 1);
          w += span;
          for (let k = 1; k < Number(c.attrs.rowspan ?? 1); k++)
            pending[r + k] = (pending[r + k] ?? 0) + span;
        });
        widths.push(w);
      });
      expect(new Set(widths).size).toBe(1);
      return false;
    });
  });

  it('measure: setContent(large.json) and getHTML() in jsdom (recorded, no threshold)', () => {
    const editor = makeEditor('<p></p>');
    const t0 = performance.now();
    editor.commands.setContent(LARGE.doc);
    const t1 = performance.now();
    const html = editor.getHTML();
    const t2 = performance.now();
    editor.commands.setContent(html);
    const t3 = performance.now();
    const json = JSON.stringify(editor.getJSON());
    console.warn(
      `[measure] large.json (${LARGE.doc.content?.length} blocks): setContent ${(t1 - t0).toFixed(1)} ms, getHTML ${(t2 - t1).toFixed(1)} ms (${html.length} chars), setContent(html) ${(t3 - t2).toFixed(1)} ms, getJSON+stringify ${(performance.now() - t3).toFixed(1)} ms (${json.length} chars)`,
    );
    expect(html.length).toBeGreaterThan(0);
    // Recorded, not a threshold: same large-fixture budget as the gate above (CI runs ~4x slower).
  }, 20_000);
});

describe('HTML output fidelity', () => {
  it('getHTML writes inline styles exactly as rendered (no browser canonicalisation)', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { marginLeft: '10pt' },
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [
                {
                  type: 'textStyle',
                  attrs: {
                    color: '#1f4e79',
                    fontFamily: '"맑은 고딕", "Noto Sans KR", sans-serif',
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    const html = editor.getHTML();
    expect(html).toContain('color: #1f4e79');
    expect(html).toContain(
      'font-family: &quot;맑은 고딕&quot;, &quot;Noto Sans KR&quot;, sans-serif',
    );
    expect(html).toContain('margin-left: 10pt');
    // the editing view is untouched (rendered by ProseMirror as before)
    expect(editor.view.dom.innerHTML).not.toContain('#1f4e79');
  });
});

/** A mark that renders HTML but has no parse rule: it is lost on the HTML trip. */
const RenderOnly = Mark.create({
  name: 'renderOnly',
  renderHTML: () => ['samp', { 'data-render-only': '' }, 0],
});

describe('diagnoseRoundtrip', () => {
  const doc: JSONContent = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { lineHeight: '1.6', marginLeft: '10pt' },
        content: [
          { type: 'text', text: 'a', marks: [{ type: 'bold' }, { type: 'renderOnly' }] },
          { type: 'text', text: 'b' },
        ],
      },
    ],
  };

  it('lossless input: empty list', () => {
    const result = diagnoseRoundtrip(doc, [...createEditorExtensions(), RenderOnly]);
    expect(result.diffs).toEqual([]);
    expect(result.lossless).toBe(true);
  });

  it('an attribute the schema drops is listed as node path + attribute name', () => {
    // Without the guard and the paragraph attributes, ProseMirror silently drops lineHeight/marginLeft.
    const extensions = createEditorExtensions({
      features: { paragraphAttributes: false, contentGuard: false },
    });
    const result = diagnoseRoundtrip(doc, [...extensions, RenderOnly]);
    expect(result.lossless).toBe(false);
    expect(result.diffs.map((d) => `${d.kind} ${d.path}`)).toEqual([
      'attr-dropped content[0](paragraph).attrs.lineHeight',
      'attr-dropped content[0](paragraph).attrs.marginLeft',
    ]);
    expect(result.diffs[0]).toMatchObject({ before: '1.6', after: null });
  });

  it('a mark lost on the HTML trip keeps its block as rawHtml', () => {
    // The render-only mark has no parse rule, so the paragraph cannot round-trip: since it
    // is preserved verbatim (mark included) instead of parsed with the mark dropped.
    const result = diagnoseRoundtrip(doc, [...createEditorExtensions(), RenderOnly], {
      via: 'html',
    });
    expect(result.diffs.map((d) => `${d.kind} ${d.path}`)).toEqual([
      'node-type-changed content[0](paragraph)',
    ]);
  });

  it('without the guard, an unknown node empties the document: reported as missing nodes', () => {
    const withUnknown: JSONContent = {
      type: 'doc',
      content: [...doc.content!, { type: 'mysteryBlock' }],
    };
    const extensions = createEditorExtensions({ features: { contentGuard: false } });
    const warn = console.warn;
    console.warn = () => {};
    try {
      const result = diagnoseRoundtrip(withUnknown, [...extensions, RenderOnly]);
      expect(result.diffs.map((d) => d.kind)).toContain('missing-node');
      // with the guard (default) the same input is lossless
      expect(
        diagnoseRoundtrip(withUnknown, [...createEditorExtensions(), RenderOnly]).lossless,
      ).toBe(true);
    } finally {
      console.warn = warn;
    }
  });
});
