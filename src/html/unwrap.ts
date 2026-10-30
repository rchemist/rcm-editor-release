// Legacy HTML unwrapping (admission-notice style content).
//
// Past TipTap versions stored raw HTML inside a code block:
// `<pre><code class="language-html">ESCAPED</code></pre>`. This unwraps such blocks back to the
// real markup. Code blocks in any other language are left untouched. This is NOT editor default
// behavior: call it explicitly when migrating legacy values (the listgrid adapter does).
const HTML_CODE_BLOCK =
  /<pre\b[^>]*>\s*<code\b[^>]*class=(?:"[^"]*\blanguage-html\b[^"]*"|'[^']*\blanguage-html\b[^']*')[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/g;

function decodeEntities(encoded: string): string {
  if (typeof document !== 'undefined') {
    const area = document.createElement('textarea');
    area.innerHTML = encoded;
    return area.value;
  }
  // No DOM (SSR/Node): decode the entities HTML escaping produces, named and numeric.
  return encoded
    .replace(/&(lt|gt|quot|amp);/g, (_m, name: string) => {
      switch (name) {
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        default:
          return '&';
      }
    })
    .replace(/&#(\d+);/g, (_m, digits: string) => {
      try {
        return String.fromCodePoint(Number(digits));
      } catch {
        return _m;
      }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, digits: string) => {
      try {
        return String.fromCodePoint(parseInt(digits, 16));
      } catch {
        return _m;
      }
    })
    .replace(/&(apos|nbsp);/g, (_m, name: string) => (name === 'apos' ? "'" : '\u00A0'));
}

/**
 * Unwraps legacy `<pre><code class="language-html">ESCAPED</code></pre>` values to the real HTML
 * they hold (legacy `unwrapHtmlCodeBlocks`). Blocks in other languages pass through unchanged, as
 * does input without such blocks (returned as-is).
 */
export function unwrapHtmlCodeBlocks(html: string): string {
  if (!html) return html;
  HTML_CODE_BLOCK.lastIndex = 0;
  if (!HTML_CODE_BLOCK.test(html)) return html;
  HTML_CODE_BLOCK.lastIndex = 0;
  return html.replace(HTML_CODE_BLOCK, (_match, encoded: string) => decodeEntities(encoded));
}
