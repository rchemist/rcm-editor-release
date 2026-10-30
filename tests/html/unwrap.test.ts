import { afterEach, describe, expect, it } from 'vitest';
import { destroyEditors, makeEditor } from '../helpers/editor';
import { unwrapHtmlCodeBlocks } from '../../src/index';

afterEach(destroyEditors);

describe('legacy code-block unwrap', () => {
  it('unwraps language-html blocks and leaves everything else untouched', () => {
    expect(
      unwrapHtmlCodeBlocks('<pre><code class="language-html">&lt;p&gt;x&lt;/p&gt;</code></pre>'),
    ).toBe('<p>x</p>');
    expect(
      unwrapHtmlCodeBlocks(
        '<pre><code class="language-html">&lt;a href=&quot;/x?a=1&amp;b=2&quot;&gt;t&lt;/a&gt;</code></pre>',
      ),
    ).toBe('<a href="/x?a=1&b=2">t</a>');
    const js = '<pre><code class="language-javascript">let x = 1;</code></pre>';
    expect(unwrapHtmlCodeBlocks(js)).toBe(js);
    expect(unwrapHtmlCodeBlocks('<p>plain</p>')).toBe('<p>plain</p>');
    expect(unwrapHtmlCodeBlocks('')).toBe('');
  });

  it('an unwrapped legacy value loads as live content', () => {
    const editor = makeEditor(
      unwrapHtmlCodeBlocks(
        '<pre><code class="language-html">&lt;p&gt;legacy&lt;/p&gt;</code></pre>',
      ),
    );
    expect(editor.getJSON().content?.map((n) => n.type)).toEqual(['paragraph']);
    expect(editor.getText()).toContain('legacy');
  });
});
