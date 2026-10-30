import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import {
  DocparserImportError,
  createDocparserAssetResolver,
  fromDocparser,
} from '../../src/docparser/index';
import type { DocparserImportErrorCode } from '../../src/docparser/index';
import { PNG_SHA, PNG_SRC, doc, imageBlock, loadProfileFixture, para, pngAsset } from './helpers';

let counter = 0;
const created: string[] = [];
const revoked: string[] = [];

beforeEach(() => {
  counter = 0;
  created.length = 0;
  revoked.length = 0;
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:test/${++counter}`;
    created.push(url);
    return url;
  }) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });
});
afterEach(() => vi.restoreAllMocks());

const codeOf = (fn: () => unknown): DocparserImportErrorCode | undefined => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DocparserImportError);
    return (e as DocparserImportError).code;
  }
  return undefined;
};

const footnotes = (...ids: string[]): JSONContent => ({
  type: 'footnotes',
  content: ids.map((id) => ({
    type: 'footnote',
    attrs: { id, label: id },
    content: [para(`note ${id}`)],
  })),
});

describe('fromDocparser: single doc', () => {
  it('returns the doc as content with assets resolved lazily and cached', () => {
    const res = {
      doc: doc(para('a'), imageBlock()),
      assets: [pngAsset()],
      render_revision: 'tiptap-0.1.1',
    };
    const out = fromDocparser(res);
    expect(out.content).toEqual(res.doc);
    expect(out.renderRevision).toBe('tiptap-0.1.1');
    expect(out.ranges).toEqual([{ index: 0 }]);
    expect(out.warnings).toEqual([]);
    expect(created).toEqual([]); // nothing until the first resolve
    const url = out.resolveAsset(PNG_SRC);
    expect(url).toBe('blob:test/1');
    expect(out.resolveAsset(PNG_SRC)).toBe(url);
    expect(created).toHaveLength(1);
    expect(out.resolveAsset(`asset:sha256:${'0'.repeat(64)}`)).toBeUndefined();
    expect(out.resolveAsset('https://example.test/x.png')).toBeUndefined();
  });

  it('dispose() revokes every created URL once and is idempotent', () => {
    const out = fromDocparser({ doc: doc(imageBlock()), assets: [pngAsset()] });
    const url = out.resolveAsset(PNG_SRC);
    out.dispose();
    out.dispose();
    expect(revoked).toEqual([url]);
    expect(out.resolveAsset(PNG_SRC)).toBeUndefined();
  });

  it('never mutates the input and shares no objects with it', () => {
    const res = {
      doc: doc(para('a')),
      assets: [pngAsset()],
      warnings: [{ code: 'w', ordinal: null }],
    };
    const before = JSON.stringify(res);
    const out = fromDocparser(res);
    expect(JSON.stringify(res)).toBe(before);
    expect(out.content).not.toBe(res.doc);
    expect(out.content.content![0]).not.toBe(res.doc.content![0]);
    expect(out.warnings).toEqual(res.warnings);
    expect(out.warnings[0]).not.toBe(res.warnings[0]);
  });

  it('a profile fixture response (pageBreak, figure) passes through unchanged', () => {
    const fx = loadProfileFixture('synthetic-profile');
    const out = fromDocparser({ doc: fx.doc, render_revision: fx.render_revision });
    expect(out.content).toEqual(fx.doc);
    expect(out.renderRevision).toBe(fx.render_revision);
    expect(out.renderRevision).toMatch(/^tiptap-0\.1\.1\+rcm-editor\.\d+$/);
  });
});

describe('fromDocparser: docs[]', () => {
  const docs = [
    { range: { start: { section: 1, para: 1 } }, doc: doc(para('r0')), title: '제1장' },
    { range: {}, doc: doc(para('r1')) },
    doc(para('r2')),
  ];
  const types = (c: JSONContent) => c.content!.map((n) => n.type);

  it('concat (default) joins with a pageBreak and reports one range per doc', () => {
    const out = fromDocparser({ docs });
    expect(types(out.content)).toEqual([
      'paragraph',
      'pageBreak',
      'paragraph',
      'pageBreak',
      'paragraph',
    ]);
    expect(out.ranges).toEqual([{ index: 0, title: '제1장' }, { index: 1 }, { index: 2 }]);
  });

  it.each([
    ['horizontalRule', ['paragraph', 'horizontalRule', 'paragraph', 'horizontalRule', 'paragraph']],
    ['none', ['paragraph', 'paragraph', 'paragraph']],
  ] as const)('separator %s', (separator, expected) => {
    expect(types(fromDocparser({ docs }, { separator }).content)).toEqual(expected);
  });

  it('separator function gets the index of the following range', () => {
    const calls: number[] = [];
    const out = fromDocparser(
      { docs },
      {
        separator: (i) => {
          calls.push(i);
          return [
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: `#${i}` }] },
          ];
        },
      },
    );
    expect(calls).toEqual([1, 2]);
    expect(types(out.content)).toEqual([
      'paragraph',
      'heading',
      'paragraph',
      'heading',
      'paragraph',
    ]);
  });

  it('select picks one range (default 0)', () => {
    expect(fromDocparser({ docs }, { ranges: 'select', index: 1 }).content).toEqual(
      doc(para('r1')),
    );
    expect(fromDocparser({ docs }, { ranges: 'select' }).content).toEqual(doc(para('r0')));
    expect(fromDocparser({ docs }, { ranges: 'select', index: 2 }).ranges).toHaveLength(3);
  });

  it('concat merges per-range trailing footnotes blocks into one at the end (ids deduplicated)', () => {
    const out = fromDocparser({
      docs: [
        { doc: doc(para('a'), footnotes('1', '2')) },
        { doc: doc(para('b'), footnotes('2', '3')) },
      ],
    });
    expect(types(out.content)).toEqual(['paragraph', 'pageBreak', 'paragraph', 'footnotes']);
    const last = out.content.content![3]!;
    expect(last.content!.map((n) => n.attrs!.id)).toEqual(['1', '2', '3']);
  });

  it('assets of all ranges resolve; a caller-provided resolver is merged into and kept on dispose', () => {
    const shared = createDocparserAssetResolver();
    const out = fromDocparser({ docs, assets: [pngAsset()] }, { resolver: shared });
    expect(out.resolveAsset).toBe(shared);
    const url = shared(PNG_SRC);
    out.dispose();
    expect(revoked).toEqual([]);
    expect(shared(PNG_SRC)).toBe(url);
    shared.dispose();
    expect(revoked).toEqual([url]);
  });
});

describe('fromDocparser: malformed input', () => {
  const ok = doc(para('a'));
  it.each<[string, unknown, DocparserImportErrorCode]>([
    ['null', null, 'invalid_response'],
    ['array', [], 'invalid_response'],
    ['string', 'x', 'invalid_response'],
    ['neither doc nor docs', {}, 'invalid_response'],
    ['both doc and docs', { doc: ok, docs: [ok] }, 'invalid_response'],
    ['docs not an array', { docs: {} }, 'invalid_response'],
    ['docs empty', { docs: [] }, 'invalid_response'],
    ['warnings not an array', { doc: ok, warnings: {} }, 'invalid_response'],
    ['warning without code', { doc: ok, warnings: [{}] }, 'invalid_response'],
    ['render_revision not a string', { doc: ok, render_revision: 3 }, 'invalid_response'],
    ['doc not a doc node', { doc: { type: 'paragraph' } }, 'invalid_doc'],
    ['doc content not an array', { doc: { type: 'doc', content: {} } }, 'invalid_doc'],
    ['doc child without type', { doc: { type: 'doc', content: [{}] } }, 'invalid_doc'],
    ['docs item not a doc', { docs: [{ doc: 3 }] }, 'invalid_doc'],
    [
      'asset without bytes',
      { doc: ok, assets: [{ sha256: 'ab', media_type: 'image/png' }] },
      'invalid_asset',
    ],
    ['asset not an object', { doc: ok, assets: [3] }, 'invalid_asset'],
    [
      'asset sha not hex',
      { doc: ok, assets: [{ sha256: 'zz', media_type: 'a', bytes_b64: 'AA==' }] },
      'invalid_asset',
    ],
    ['assets not an array', { doc: ok, assets: {} }, 'invalid_asset'],
  ])('%s -> %s', (_name, input, code) => {
    expect(codeOf(() => fromDocparser(input as never))).toBe(code);
  });

  it('bad options: unknown ranges mode, unknown separator, non-integer / out-of-range index', () => {
    const docs = [ok, ok];
    expect(codeOf(() => fromDocparser({ docs }, { ranges: 'x' as never }))).toBe('invalid_option');
    expect(codeOf(() => fromDocparser({ docs }, { separator: 'x' as never }))).toBe(
      'invalid_option',
    );
    expect(codeOf(() => fromDocparser({ docs }, { ranges: 'select', index: 1.5 }))).toBe(
      'invalid_option',
    );
    expect(codeOf(() => fromDocparser({ docs }, { ranges: 'select', index: 2 }))).toBe(
      'range_out_of_bounds',
    );
    expect(codeOf(() => fromDocparser({ docs }, { ranges: 'select', index: -1 }))).toBe(
      'range_out_of_bounds',
    );
    expect(codeOf(() => fromDocparser({ docs }, { separator: () => [{} as never] }))).toBe(
      'invalid_option',
    );
  });

  it('a rejected response leaves a shared resolver untouched', () => {
    const shared = createDocparserAssetResolver();
    expect(
      codeOf(() =>
        fromDocparser(
          { docs: [ok], assets: [pngAsset()] },
          { ranges: 'select', index: 5, resolver: shared },
        ),
      ),
    ).toBe('range_out_of_bounds');
    expect(shared(PNG_SRC)).toBeUndefined();
  });

  it('undecodable base64 resolves to undefined instead of throwing', () => {
    const out = fromDocparser({
      doc: ok,
      assets: [{ sha256: PNG_SHA, media_type: 'image/png', bytes_b64: '***not base64***' }],
    });
    expect(out.resolveAsset(PNG_SRC)).toBeUndefined();
  });
});

describe('createDocparserAssetResolver', () => {
  it('add() merges responses, keeps the first copy of a sha, and dispose() revokes all', () => {
    const resolver = createDocparserAssetResolver([pngAsset()]);
    const other = { ...pngAsset(), sha256: 'AB'.repeat(32) };
    resolver.add([other, { ...pngAsset() }]);
    const a = resolver(PNG_SRC);
    const b = resolver(`asset:sha256:${'ab'.repeat(32)}`);
    expect(a).not.toBe(b);
    resolver.dispose();
    expect(revoked.sort()).toEqual([a, b].sort());
    resolver.add([pngAsset()]);
    expect(resolver(PNG_SRC)).toBeDefined();
  });

  it('a malformed batch registers nothing', () => {
    const resolver = createDocparserAssetResolver();
    expect(codeOf(() => resolver.add([pngAsset(), { sha256: 'x' } as never]))).toBe(
      'invalid_asset',
    );
    expect(resolver(PNG_SRC)).toBeUndefined();
  });
});
