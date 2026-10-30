import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { printCss } from '../../src/print/index';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const contentCss = readFileSync(join(root, 'src/styles/content.css'), 'utf8');
/** The `dist/styles.css` build output, reconstructed exactly as `build:styles` builds it. */
const stylesBuild =
  readFileSync(join(root, 'src/styles/tokens.css'), 'utf8') +
  contentCss +
  readFileSync(join(root, 'src/styles/editor.css'), 'utf8');

const norm = (css: string): string => css.replace(/\s+/g, '');

/** Top-level `selector { … }` blocks of the shared source (handles one nesting level). */
function ruleBlocks(css: string): string[] {
  const blocks: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) {
        const block = css.slice(start, i + 1).trim();
        if (block && !block.startsWith('/*')) blocks.push(block);
        start = i + 1;
      }
    }
  }
  return blocks;
}

describe('print CSS shares its source with styles.css', () => {
  it('output CSS paginates tables', () => {
    const css = norm(printCss({ page: 'A4' }));
    expect(css).toContain('thead{display:table-header-group;}');
    expect(css).toContain('tr{break-inside:avoid;}');
  });

  it.each([
    ['table', (selector: string) => selector.includes('table')],
    ['paragraph', (selector: string) => /\bp\b/.test(selector)],
  ])('shared %s rules appear in styles.css and printCss()', (_label, pick) => {
    const css = printCss({ page: 'A4' });
    const wanted = ruleBlocks(contentCss).filter((block) =>
      pick(block.slice(0, block.indexOf('{'))),
    );
    expect(wanted.length).toBeGreaterThan(0);
    for (const block of wanted) {
      expect(norm(stylesBuild), `styles.css build holds ${block.slice(0, 60)}`).toContain(
        norm(block),
      );
      expect(norm(css), `printCss() holds ${block.slice(0, 60)}`).toContain(norm(block));
    }
  });
});
