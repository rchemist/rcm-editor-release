import { describe, expect, it } from 'vitest';
import { diffDocs } from '../helpers/json-equal';

const p = (attrs: Record<string, unknown> | undefined, content: unknown[]) => ({
  type: 'doc',
  content: [{ type: 'paragraph', ...(attrs ? { attrs } : {}), content }],
});

describe('json-equal helper', () => {
  it('treats null attrs, empty attrs/marks, mark order and split text runs as equal', () => {
    const a = p(undefined, [
      { type: 'text', text: 'ab', marks: [{ type: 'bold' }, { type: 'italic' }] },
    ]);
    const b = p({ indent: null }, [
      { type: 'text', text: 'a', marks: [{ type: 'italic' }, { type: 'bold' }] },
      { type: 'text', text: 'b', marks: [{ attrs: {}, type: 'bold' }, { type: 'italic' }] },
    ]);
    expect(diffDocs(a, b)).toEqual([]);
  });

  it('reports the path of a dropped attribute', () => {
    const a = p({ lineHeight: '1.6', marginLeft: '10pt' }, [{ type: 'text', text: 'x' }]);
    const b = p({ marginLeft: '10pt' }, [{ type: 'text', text: 'x' }]);
    expect(diffDocs(a, b)).toEqual([
      { path: 'content[0](paragraph).attrs.lineHeight', expected: '1.6', actual: null },
    ]);
  });
});
