// security boundary: no content path may execute script in the host page or turn literal
// text into live markup. Every input path (HTML load, JSON load, paste/drop, insertContent)
// must clean `rawHtml` payloads, report every removal, and render previews script-less.
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import {
  applyHtmlPolicy,
  createEditorExtensions,
  getContentReport,
  getLosslessHTML,
  getLosslessJSON,
} from '../../src/index';
import type { ContentReport } from '../../src/index';
import { htmlPolicyOf } from '../../src/guard/contentGuard';
import { applyFragmentToEditor, sourcePreviewPayload } from '../../src/react/source/apply';
import { mountEditor } from '../../src/vanilla';
import { destroyEditors, makeEditor } from '../helpers/editor';

afterEach(destroyEditors);

/** `on*` payload every input path tries to smuggle in. */
const ONERROR = '<img src=x onerror=alert(1)>';
/** Placeholder markup carrying `ONERROR` (the serialized form a stored document uses). */
const PLACEHOLDER = '<div data-rcm-raw-html="&lt;img src=x onerror=alert(1)&gt;"></div>';

const kinds = (report: ContentReport | null): string[] =>
  report?.policyRemoved.map((entry) => entry.kind) ?? [];

describe('SEC-1 rawHtml payload boundary', () => {
  it('SEC-1a HTML load: a smuggled placeholder payload is sanitized, the removal reported, output clean', () => {
    const reports: ContentReport[] = [];
    const editor = makeEditor(`<p>a</p>${PLACEHOLDER}`, {
      onContentReport: (r) => reports.push(r),
    });

    const doc = JSON.stringify(editor.getJSON());
    expect(doc).toContain('"rawHtml"');
    expect(doc).not.toContain('onerror');
    expect(kinds(reports[0] ?? null)).toContain('event-handler');

    // Output (`getHTML()`) carries only policy-clean raw HTML.
    const html = editor.getHTML();
    expect(html).toContain('<img src="x">');
    expect(html).not.toContain('onerror');
  });

  it('SEC-1b JSON load (initial and setContent): a stored rawHtml payload is sanitized with a report', () => {
    const dirty: JSONContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
        { type: 'rawHtml', attrs: { html: ONERROR } },
      ],
    };
    const initial = makeEditor(dirty, { onContentReport: () => {} });
    const stored = JSON.stringify(getLosslessJSON(initial));
    expect(stored).toContain('"rawHtml"');
    expect(stored).not.toContain('onerror');
    const report = getContentReport(initial);
    expect(report?.source).toBe('initial');
    expect(kinds(report)).toContain('event-handler');

    const editor = makeEditor('<p>x</p>', { onContentReport: () => {} });
    expect(editor.commands.setContent(dirty)).toBe(true);
    expect(JSON.stringify(getLosslessJSON(editor))).not.toContain('onerror');
    expect(kinds(getContentReport(editor))).toContain('event-handler');
  });

  it('SEC-1c paste: pasted HTML (placeholder or inline handler) goes through the policy, removals reported', () => {
    const reports: ContentReport[] = [];
    const editor = makeEditor('<p>text</p>', { onContentReport: (r) => reports.push(r) });
    const paste = (html: string) => {
      // ProseMirror's paste handler reads `clipboardData` only; the upload plugin's own
      // handlePaste additionally wants `files` (a real ClipboardEvent always has both).
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: { files: [], getData: (type: string) => (type === 'text/html' ? html : '') },
      });
      editor.view.dom.dispatchEvent(event);
    };

    editor.commands.setTextSelection(editor.state.doc.content.size);
    paste(PLACEHOLDER);
    let doc = JSON.stringify(editor.getJSON());
    expect(doc).toContain('"rawHtml"');
    expect(doc).not.toContain('onerror');
    expect(
      reports.some(
        (r) =>
          r.source === 'insertContent' && r.policyRemoved.some((e) => e.kind === 'event-handler'),
      ),
    ).toBe(true);

    editor.commands.setTextSelection(editor.state.doc.content.size);
    paste('<p>keep</p><img src=y onerror=alert(2)>');
    doc = JSON.stringify(editor.getJSON());
    expect(doc).toContain('"src":"y"');
    expect(doc).not.toContain('alert(2)');
    expect(reports.some((r) => r.policyRemoved.some((e) => e.detail.includes('onerror')))).toBe(
      true,
    );

    // External drops parse through the same gate (`transformPastedHTML` on both handlers).
    // ProseMirror chains every `transformPastedHTML` prop (direct first, then each plugin's):
    // mirror that composition here instead of reading a single prop.
    const chained = (html: string): string => {
      let out = html;
      editor.view.someProp('transformPastedHTML', (f) => {
        out = f(out, editor.view);
      });
      return out;
    };
    expect(chained(PLACEHOLDER)).not.toContain('onerror');
    expect(chained(ONERROR)).not.toContain('onerror');
  });

  it('SEC-1d insertContent: placeholder HTML and rawHtml JSON payloads are sanitized with a report', () => {
    const editor = makeEditor('<p>text</p>', { onContentReport: () => {} });

    expect(editor.commands.insertContent(PLACEHOLDER)).toBe(true);
    let doc = JSON.stringify(editor.getJSON());
    expect(doc).toContain('"rawHtml"');
    expect(doc).not.toContain('onerror');
    expect(kinds(getContentReport(editor))).toContain('event-handler');

    expect(editor.commands.insertContent({ type: 'rawHtml', attrs: { html: ONERROR } })).toBe(true);
    doc = JSON.stringify(editor.getJSON());
    expect(doc).not.toContain('onerror');
    expect(kinds(getContentReport(editor))).toContain('event-handler');
  });

  it('SEC-1 non-trusted previews render in a script-less iframe (sandbox without allow-scripts)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    try {
      const mounted = mountEditor(host, { defaultValue: '<p>t</p><div class="c">r</div>' });
      try {
        const frame = mounted.editor.view.dom.querySelector('iframe');
        expect(frame).not.toBeNull();
        const sandbox = frame!.getAttribute('sandbox') ?? '';
        expect(sandbox).toBe('allow-same-origin');
        expect(sandbox).not.toContain('allow-scripts');
        expect(frame!.getAttribute('srcdoc')).toContain('class="c"');
      } finally {
        mounted.destroy();
      }
    } finally {
      host.remove();
    }
  });

  it('SEC-1 trusted keeps the script-running preview unchanged (allow-scripts, no same-origin)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    try {
      const mounted = mountEditor(host, {
        defaultValue: `<p>t</p>${ONERROR}`,
        htmlPolicy: 'trusted',
      });
      try {
        const frame = mounted.editor.view.dom.querySelector('iframe');
        expect(frame).not.toBeNull();
        expect(frame!.getAttribute('sandbox')).toBe('allow-scripts');
        expect(frame!.getAttribute('srcdoc')).toContain('onerror');
      } finally {
        mounted.destroy();
      }
    } finally {
      host.remove();
    }
  });
});

describe('SEC-2 top-level text escaping', () => {
  it('SEC-2 escaped markup in top-level text stays literal text (never a live <b>)', () => {
    const editor = makeEditor('<p>ok</p>&lt;b&gt;bold?&lt;/b&gt;');
    expect(editor.getText()).toContain('<b>bold?</b>');
    const html = editor.getHTML();
    expect(html).toContain('&lt;b&gt;bold?');
    expect(html).not.toContain('<b>bold?');
  });

  it('SEC-2 an escaped placeholder in top-level text never becomes a live rawHtml node', () => {
    const editor = makeEditor(
      '<p>ok</p>&lt;div data-rcm-raw-html="&amp;lt;img src=x onerror=alert(1)&amp;gt;"&gt;&lt;/div&gt;',
    );
    const types = (editor.getJSON().content ?? []).map((n) => n.type);
    expect(types).not.toContain('rawHtml');
    expect(editor.getText()).toContain('<div data-rcm-raw-html=');
    expect(editor.getHTML()).not.toMatch(/<div data-rcm-raw-html=/);
  });
});

describe('SEC-3 SVG animation link hrefs', () => {
  const svg = (animation: string): string =>
    `<svg><a href="#go"><text>go</text>${animation}</a></svg>`;

  it('SEC-3 animate/set animating a link href to a dangerous URL is removed and reported', () => {
    for (const animation of [
      '<animate attributeName="href" values="#go;javascript:alert(1)" dur="1s"/>',
      '<animate attributeName="xlink:href" to="javascript:alert(2)"/>',
      '<set attributeName="href" to=" javascript:alert(3)"/>',
      '<animate attributeName="href" from="javascript:alert(4)" to="#go"/>',
    ]) {
      const { html, removed } = applyHtmlPolicy(svg(animation), { source: 'initial' });
      expect(html).not.toContain('javascript:');
      expect(removed.some((e) => e.kind === 'javascript-url')).toBe(true);
    }
  });

  it('SEC-3 safe animations (other target attributes, safe values) are untouched', () => {
    const input = '<svg><rect><animate attributeName="opacity" values="0;1"/></rect></svg>';
    const { html, removed } = applyHtmlPolicy(input, { source: 'initial' });
    expect(removed).toEqual([]);
    expect(html).toBe(input);
  });

  it('SEC-3 editor load: the animation payload is removed with a report and never stored', () => {
    const input =
      '<p>a</p><svg><a href="#go"><text>go</text>' +
      '<animate attributeName="href" values="#go;javascript:alert(1)"/></a></svg>';
    const editor = makeEditor(input, { onContentReport: () => {} });
    expect(kinds(getContentReport(editor))).toContain('javascript-url');
    expect(getLosslessHTML(editor)).not.toContain('javascript:');
    expect(editor.getHTML()).not.toContain('javascript:');
  });
});

describe('SEC-5 object and embed hosts', () => {
  it('SEC-5 off-host object[data] and embed[src] are removed as iframe-host; listed hosts stay', () => {
    const { html, removed } = applyHtmlPolicy(
      '<object data="https://evil.test/x.svg"></object>' +
        '<embed src="https://evil.test/y.svg">' +
        '<embed src="https://www.youtube.com/embed/abc">',
      { source: 'initial' },
    );
    expect(removed.filter((e) => e.kind === 'iframe-host')).toHaveLength(2);
    expect(html).not.toContain('evil.test');
    expect(html).toContain('www.youtube.com/embed/abc');
  });
});

describe('one choke point: the same malicious payload through every path', () => {
  const PAYLOAD = '<img src=x onerror=alert(1)>';
  const rawJson = (): JSONContent => ({ type: 'rawHtml', attrs: { html: PAYLOAD } });
  const rawDoc = (): JSONContent => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }, rawJson()],
  });

  /** A paste/drop event stub (jsdom has no `ClipboardEvent`; `pasteHTML` takes the event). */
  const pasteEvent = () =>
    ({
      preventDefault() {},
      clipboardData: { files: [], getData: () => '' },
    }) as unknown as ClipboardEvent;

  /** Output guarantee (item 5): non-trusted `getHTML()`/`getLosslessHTML()` stay clean. */
  const expectCleanOutputs = (editor: Editor): void => {
    expect(editor.getHTML()).not.toContain('onerror');
    expect(editor.getHTML()).not.toContain('alert(1)');
    expect(getLosslessHTML(editor)).not.toContain('onerror');
    expect(JSON.stringify(editor.getJSON())).not.toContain('onerror');
  };

  /** Every removal is reported, never silent. */
  const expectReported = (reports: ContentReport[]): void => {
    expect(reports.some((r) => r.policyRemoved.length > 0)).toBe(true);
    expect(
      reports.some((r) => r.policyRemoved.some((entry) => entry.kind === 'event-handler')),
    ).toBe(true);
  };

  /** Position of the first `rawHtml` node in the document. */
  const rawPos = (editor: Editor): number => {
    let pos = -1;
    editor.state.doc.descendants((node, at) => {
      if (pos < 0 && node.type.name === 'rawHtml') pos = at;
    });
    expect(pos).toBeGreaterThanOrEqual(0);
    return pos;
  };

  interface Path {
    name: string;
    /** Delivers the payload; fragment paths assert their own return-value report. */
    run: (reports: ContentReport[]) => Editor;
    /** False when the path reports through a return value instead of `onContentReport`. */
    channel: boolean;
    /** True for editors built directly (the loop destroys them; `makeEditor` ones die in `afterEach`). */
    owned: boolean;
  }

  const paths: Path[] = [
    {
      name: 'AC1-html-initial',
      run: (reports) =>
        makeEditor(`<p>a</p>${PAYLOAD}`, { onContentReport: (r) => reports.push(r) }),
      channel: true,
      owned: false,
    },
    {
      name: 'AC1-html-setContent',
      run: (reports) => {
        const editor = makeEditor('<p>a</p>', { onContentReport: (r) => reports.push(r) });
        expect(editor.commands.setContent(`<p>a</p>${PAYLOAD}`)).toBe(true);
        return editor;
      },
      channel: true,
      owned: false,
    },
    {
      name: 'AC1-html-insertContent',
      run: (reports) => {
        const editor = makeEditor('<p>a</p>', { onContentReport: (r) => reports.push(r) });
        expect(editor.commands.insertContent(`<p>b</p>${PAYLOAD}`)).toBe(true);
        return editor;
      },
      channel: true,
      owned: false,
    },
    {
      name: 'AC1-json-initial',
      run: (reports) => makeEditor(rawDoc(), { onContentReport: (r) => reports.push(r) }),
      channel: true,
      owned: false,
    },
    {
      name: 'AC1-json-setContent',
      run: (reports) => {
        const editor = makeEditor('<p>a</p>', { onContentReport: (r) => reports.push(r) });
        expect(editor.commands.setContent(rawDoc())).toBe(true);
        return editor;
      },
      channel: true,
      owned: false,
    },
    {
      name: 'AC1-json-insertContent',
      run: (reports) => {
        const editor = makeEditor('<p>a</p>', { onContentReport: (r) => reports.push(r) });
        expect(editor.commands.insertContent(rawJson())).toBe(true);
        return editor;
      },
      channel: true,
      owned: false,
    },
    {
      name: 'AC1-insertDocument',
      run: (reports) => {
        const editor = makeEditor('<p>a</p>', { onContentReport: (r) => reports.push(r) });
        expect(editor.commands.insertDocument(rawDoc())).toBe(true);
        return editor;
      },
      channel: true,
      owned: false,
    },
    {
      name: 'AC1-paste',
      run: (reports) => {
        const editor = makeEditor('<p>a</p>', { onContentReport: (r) => reports.push(r) });
        editor.view.pasteHTML(`<p>keep</p>${PAYLOAD}`, pasteEvent());
        return editor;
      },
      channel: true,
      owned: false,
    },
    {
      name: 'AC1-paste-consumer-transform-plus-setOptions',
      run: (reports) => {
        const editor = new Editor({
          extensions: createEditorExtensions({ onContentReport: (r) => reports.push(r) }),
          content: '<p>a</p>',
          editorProps: { transformPastedHTML: (html) => html },
        });
        try {
          // What the React shell does on mount: must not drop the policy hook.
          editor.setOptions({});
          editor.view.pasteHTML(`<p>keep</p>${PAYLOAD}`, pasteEvent());
          return editor;
        } catch (error) {
          editor.destroy();
          throw error;
        }
      },
      channel: true,
      owned: true,
    },
    {
      name: 'AC1-paste-consumer-evil-transform',
      run: (reports) => {
        const editor = new Editor({
          extensions: createEditorExtensions({ onContentReport: (r) => reports.push(r) }),
          content: '<p>a</p>',
          // Runs before the policy hook and reintroduces the payload: still cleaned.
          editorProps: { transformPastedHTML: () => PAYLOAD },
        });
        try {
          editor.view.pasteHTML('<p>harmless</p>', pasteEvent());
          return editor;
        } catch (error) {
          editor.destroy();
          throw error;
        }
      },
      channel: true,
      owned: true,
    },
    {
      name: 'AC1-source-preview',
      run: (reports) => {
        const editor = makeEditor('<p>a</p>', { onContentReport: (r) => reports.push(r) });
        const payload = sourcePreviewPayload(
          editor.schema,
          `<p>ok</p>${PAYLOAD}`,
          htmlPolicyOf(editor),
        );
        expect(payload.html).not.toContain('onerror');
        expect(JSON.stringify(payload.json)).not.toContain('onerror');
        // Source-mode apply goes through `setContent` (covered above); the preview is clean.
        expect(editor.commands.setContent(`<p>ok</p>${PAYLOAD}`)).toBe(true);
        return editor;
      },
      channel: true,
      owned: false,
    },
    {
      name: 'AC1-fragment-apply',
      run: (reports) => {
        const editor = makeEditor('<p>a</p><div class="keepme">x</div>', {
          onContentReport: (r) => reports.push(r),
        });
        const result = applyFragmentToEditor(
          editor,
          rawPos(editor),
          `<p>new</p>${PAYLOAD}`,
          'apply',
          htmlPolicyOf(editor),
        );
        expect(result?.policyRemoved.some((entry) => entry.kind === 'event-handler')).toBe(true);
        return editor;
      },
      channel: false,
      owned: false,
    },
    {
      name: 'AC1-fragment-convert',
      run: (reports) => {
        const editor = makeEditor('<p>a</p><div class="keepme">x</div>', {
          onContentReport: (r) => reports.push(r),
        });
        const result = applyFragmentToEditor(
          editor,
          rawPos(editor),
          `<p>new</p>${PAYLOAD}`,
          'convert',
          htmlPolicyOf(editor),
        );
        expect(result?.policyRemoved.some((entry) => entry.kind === 'event-handler')).toBe(true);
        return editor;
      },
      channel: false,
      owned: false,
    },
    {
      name: 'AC1-setNodeMarkup',
      run: (reports) => {
        const editor = makeEditor('<p>a</p><div class="keepme">x</div>', {
          onContentReport: (r) => reports.push(r),
        });
        const at = rawPos(editor);
        const node = editor.state.doc.nodeAt(at);
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(at, undefined, { ...node?.attrs, html: PAYLOAD }),
        );
        return editor;
      },
      channel: true,
      owned: false,
    },
  ];

  for (const path of paths) {
    it(path.name, () => {
      const reports: ContentReport[] = [];
      const editor = path.run(reports);
      try {
        expectCleanOutputs(editor);
        // Fragment paths assert their return-value report inside `run`; every other path must
        // have reported through `onContentReport`.
        if (path.channel) expectReported(reports);
      } finally {
        if (path.owned) editor.destroy();
      }
    });
  }

  it('AC1-trusted-keeps-payload-verbatim', () => {
    const reports: ContentReport[] = [];
    const editor = makeEditor(rawDoc(), {
      htmlPolicy: 'trusted',
      onContentReport: (r) => reports.push(r),
    });
    expect(JSON.stringify(editor.getJSON())).toContain('onerror');
    expect(reports.every((r) => r.policyRemoved.length === 0)).toBe(true);
  });

  it('AC1-fixup-undoes-with-its-transaction', () => {
    const editor = makeEditor('<p>a</p>');
    const before = JSON.stringify(editor.getJSON());
    expect(editor.commands.insertDocument(rawDoc())).toBe(true);
    expect(JSON.stringify(editor.getJSON())).not.toContain('onerror');
    expect(editor.commands.undo()).toBe(true);
    expect(JSON.stringify(editor.getJSON())).toBe(before);
  });
});

describe('configured iframeHosts survive every path', () => {
  const HOSTS = ['example.com'];
  const ALLOWED = '<iframe src="https://example.com/embed/x"></iframe>';
  const rawJson = (): JSONContent => ({ type: 'rawHtml', attrs: { html: ALLOWED } });
  const pasteEvent = () =>
    ({
      preventDefault() {},
      clipboardData: { files: [], getData: () => '' },
    }) as unknown as ClipboardEvent;

  /** The kept iframe is verbatim in the output and nothing was reported removed. */
  const expectKept = (editor: Editor, reports: ContentReport[]): void => {
    expect(editor.getHTML()).toContain('example.com/embed/x');
    expect(getLosslessHTML(editor)).toContain('example.com/embed/x');
    expect(reports.every((r) => r.policyRemoved.length === 0)).toBe(true);
  };

  const options = (reports: ContentReport[]) => ({
    iframeHosts: HOSTS,
    onContentReport: (r: ContentReport) => reports.push(r),
  });

  it('AC2-html-initial', () => {
    const reports: ContentReport[] = [];
    const editor = makeEditor(`<p>a</p>${ALLOWED}`, options(reports));
    expectKept(editor, reports);
  });

  it('AC2-html-setContent', () => {
    const reports: ContentReport[] = [];
    const editor = makeEditor('<p>a</p>', options(reports));
    expect(editor.commands.setContent(`<p>a</p>${ALLOWED}`)).toBe(true);
    expectKept(editor, reports);
  });

  it('AC2-html-insertContent', () => {
    const reports: ContentReport[] = [];
    const editor = makeEditor('<p>a</p>', options(reports));
    expect(editor.commands.insertContent(ALLOWED)).toBe(true);
    expectKept(editor, reports);
  });

  it('AC2-json-initial', () => {
    const reports: ContentReport[] = [];
    const editor = makeEditor(
      { type: 'doc', content: [{ type: 'paragraph' }, rawJson()] },
      options(reports),
    );
    expectKept(editor, reports);
  });

  it('AC2-json-setContent', () => {
    const reports: ContentReport[] = [];
    const editor = makeEditor('<p>a</p>', options(reports));
    expect(
      editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }, rawJson()] }),
    ).toBe(true);
    expectKept(editor, reports);
  });

  it('AC2-json-insertContent', () => {
    const reports: ContentReport[] = [];
    const editor = makeEditor('<p>a</p>', options(reports));
    expect(editor.commands.insertContent(rawJson())).toBe(true);
    expectKept(editor, reports);
  });

  it('AC2-insertDocument', () => {
    const reports: ContentReport[] = [];
    const editor = makeEditor('<p>a</p>', options(reports));
    expect(editor.commands.insertDocument({ type: 'doc', content: [rawJson()] })).toBe(true);
    expectKept(editor, reports);
  });

  it('AC2-paste', () => {
    const reports: ContentReport[] = [];
    const editor = makeEditor('<p>a</p>', options(reports));
    // Pasted markup travels as `rawHtml` placeholders (the schema has no bare-`iframe` rule —
    // a pasted bare iframe degrades the same under `trusted`, so that is not a policy loss);
    // the placeholder parses verbatim and the choke point keeps the allowed host.
    const placeholder =
      '<div data-rcm-raw-html="&lt;iframe src=&quot;https://example.com/embed/x&quot;&gt;&lt;/iframe&gt;"></div>';
    editor.view.pasteHTML(placeholder, pasteEvent());
    expectKept(editor, reports);
  });

  it('AC2-off-host-iframe-still-removed-and-reported', () => {
    const reports: ContentReport[] = [];
    const editor = makeEditor('<p>a</p>', options(reports));
    expect(editor.commands.setContent('<p>a</p><iframe src="https://evil.test/x"></iframe>')).toBe(
      true,
    );
    expect(editor.getHTML()).not.toContain('evil.test');
    expect(reports.some((r) => r.policyRemoved.some((entry) => entry.kind === 'iframe-host'))).toBe(
      true,
    );
  });
});

describe('sanitizer-net losses are reported, never silent', () => {
  it('N4-attribute-value-stripped-in-place-reported-as-other', () => {
    const { html, removed } = applyHtmlPolicy('<p title="a</iframe>b">x</p>', {
      source: 'initial',
    });
    expect(html).not.toContain('</iframe');
    expect(removed.some((entry) => entry.kind === 'other')).toBe(true);
  });

  it('N4-mso-conditional-comment-reported-as-other', () => {
    const { html, removed } = applyHtmlPolicy('<p>a</p><!--[if mso]><p>outlook</p><![endif]-->', {
      source: 'initial',
    });
    expect(removed.some((entry) => entry.kind === 'other')).toBe(true);
    expect(removed.some((entry) => entry.detail.includes('mso'))).toBe(true);
    expect(html).not.toContain('mso');
  });

  it('N4-editor-load-reports-net-removals', () => {
    const reports: ContentReport[] = [];
    makeEditor('<p>a</p><p title="a-->b">x</p>', {
      onContentReport: (r) => reports.push(r),
    });
    expect(reports.some((r) => r.policyRemoved.some((entry) => entry.kind === 'other'))).toBe(true);
  });
});

describe('shared rawHtml reference resolves to the cleaned copy', () => {
  it('N5-shared-object-twice-both-clean', () => {
    const shared: JSONContent = {
      type: 'rawHtml',
      attrs: { html: '<img src=x onerror=alert(1)>' },
    };
    const reports: ContentReport[] = [];
    const editor = makeEditor(
      {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }, shared, shared],
      },
      { onContentReport: (r) => reports.push(r) },
    );
    const doc = JSON.stringify(editor.getJSON());
    expect(doc).not.toContain('onerror');
    expect(doc.match(/"rawHtml"/g)).toHaveLength(2);
    // (`\"` in the JSON string; `img src=` itself is literal.)
    expect(doc.split('img src=').length - 1).toBe(2);
    expect(
      reports.some((r) => r.policyRemoved.some((entry) => entry.kind === 'event-handler')),
    ).toBe(true);
  });
});

describe('placeholder shielding keeps the sanitizer on placeholder subtrees', () => {
  // A noscript parser differential wrapped in a placeholder element.
  const NOSCRIPT = '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></p></noscript>';
  const WRAP = `<div data-rcm-raw-html="">${NOSCRIPT}</div>`;

  it('F1-policy-sanitizes-placeholder-children', () => {
    const { html, removed } = applyHtmlPolicy(WRAP, { source: 'initial' });
    expect(html).not.toContain('onerror');
    expect(removed.length).toBeGreaterThan(0);
  });

  it('F1-json-insert-of-wrapped-payload-is-clean-and-reported', () => {
    const reports: ContentReport[] = [];
    const editor = makeEditor('<p>a</p>', { onContentReport: (r) => reports.push(r) });
    editor.commands.insertContent({ type: 'rawHtml', attrs: { html: WRAP } });
    expect(editor.getHTML()).not.toContain('onerror');
    expect(reports.some((r) => r.policyRemoved.length > 0)).toBe(true);
  });

  it('F1-html-load-of-wrapped-placeholder-is-clean', () => {
    const editor = makeEditor(`<p>a</p>${WRAP}`);
    expect(getLosslessHTML(editor)).not.toContain('onerror');
    expect(editor.getHTML()).not.toContain('onerror');
  });

  it('F1-allowed-iframe-payload-still-survives-the-net', () => {
    const payload = '<iframe src="https://www.youtube.com/embed/x"></iframe>';
    const input = `<div data-rcm-raw-html="${payload.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}"></div>`;
    const { html, removed } = applyHtmlPolicy(input, { source: 'initial' });
    expect(removed).toEqual([]);
    expect(html).toBe(input);
  });
});

describe('choke point fixup cannot be forged', () => {
  it('F2-string-meta-does-not-skip-the-choke-point', () => {
    const editor = makeEditor('<p>a</p>');
    editor.commands.insertContent({ type: 'rawHtml', attrs: { html: '<b>ok</b>' } });
    let pos = -1;
    editor.state.doc.descendants((node, p) => {
      if (node.type.name === 'rawHtml') pos = p;
    });
    const tr = editor.state.tr
      .setNodeMarkup(pos, undefined, { html: ONERROR })
      .setMeta('rcmPolicyFixup', true)
      .setMeta('rcmPolicyFixup$', true);
    editor.view.dispatch(tr);
    expect(editor.getHTML()).not.toContain('onerror');
  });

  it('F4-nested-placeholder-in-payload-is-sanitized', () => {
    const editor = makeEditor('<p>a</p>');
    const nested = `<div data-rcm-raw-html="${ONERROR.replace(/</g, '&lt;').replace(/>/g, '&gt;')}"></div>`;
    editor.commands.insertContent({ type: 'rawHtml', attrs: { html: nested } });
    expect(getLosslessHTML(editor)).not.toContain('onerror');
  });
});
