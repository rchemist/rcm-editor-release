import { useCallback, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { Editor } from '@tiptap/react';
import { getLosslessJSON } from '@rchemist/editor';
import { DocparserImportError, fromDocparser } from '@rchemist/editor/docparser';
import type { DocparserResponse } from '@rchemist/editor/docparser';
import type { ContentReport } from '@rchemist/editor';
import { EditorHost } from './EditorHost';
import { playgroundAssets } from './fixtureAssets';

declare global {
  interface Window {
    /** Playground test hook (e2e): the live editor and its lossless JSON. */
    __rcmPlayground?: { editor: Editor; getLosslessJSON: () => unknown };
  }
}

const fixtureLoaders = import.meta.glob('../../../fixtures/**/*.json', {
  import: 'default',
}) as Record<string, () => Promise<unknown>>;
const fixturePaths = Object.keys(fixtureLoaders).sort();

type Theme = 'light' | 'dark';

export function App() {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [json, setJson] = useState('');
  const [html, setHtml] = useState('');
  const [theme, setTheme] = useState<Theme>('light');
  const [error, setError] = useState('');
  const [report, setReport] = useState<ContentReport | null>(null);

  const handleEditor = useCallback((e: Editor | null) => {
    setEditor(e);
    if (e) window.__rcmPlayground = { editor: e, getLosslessJSON: () => getLosslessJSON(e) };
    else delete window.__rcmPlayground;
  }, []);

  const handleUpdate = useCallback((e: Editor) => {
    setJson(JSON.stringify(getLosslessJSON(e), null, 2));
    setHtml(e.getHTML());
  }, []);

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    setTheme(next);
  };

  const loadFixture = async (e: ChangeEvent<HTMLSelectElement>) => {
    const loader = fixtureLoaders[e.target.value];
    if (!loader || !editor) return;
    try {
      setError('');
      setReport(null);
      // docparser fixtures wrap the document: { source, docparser_commit, render_revision, doc }.
      const data = (await loader()) as { doc?: unknown };
      editor.commands.setContent(
        (data && typeof data === 'object' && 'doc' in data ? data.doc : data) as Parameters<
          Editor['commands']['setContent']
        >[0],
      );
    } catch (err) {
      setError(String(err));
    }
  };

  const [importInfo, setImportInfo] = useState('');

  /** docparser `documents:render` response (JSON): open it, or insert it at the cursor. */
  const importResponse = (mode: 'open' | 'insert') => async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editor) return;
    try {
      setError('');
      setReport(null);
      const res = JSON.parse(await file.text()) as DocparserResponse;
      const imported = fromDocparser(res, { resolver: playgroundAssets });
      if (mode === 'open') editor.commands.setContent(imported.content);
      else if (!editor.commands.insertDocument(imported.content)) throw new Error('insert failed');
      setImportInfo(
        `${imported.renderRevision ?? '-'} · 범위 ${imported.ranges.length} · 경고 ${imported.warnings.length}`,
      );
    } catch (err) {
      setError(err instanceof DocparserImportError ? `${err.code}: ${err.message}` : String(err));
    }
  };

  const loadFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editor) return;
    try {
      setError('');
      const text = await file.text();
      if (file.name.toLowerCase().endsWith('.json')) {
        editor.commands.setContent(JSON.parse(text));
      } else {
        editor.commands.setContent(text);
      }
    } catch (err) {
      setError(String(err));
    }
    e.target.value = '';
  };

  return (
    <div className="pg">
      <header className="pg-bar">
        <strong>rcm-editor playground</strong>
        <select
          data-testid="fixture-select"
          aria-label="픽스처"
          defaultValue=""
          onChange={loadFixture}
        >
          <option value="">픽스처 선택…</option>
          {fixturePaths.map((p) => (
            <option key={p} value={p}>
              {p.replace(/^.*\/fixtures\//, '')}
            </option>
          ))}
        </select>
        <input
          data-testid="fixture-file"
          type="file"
          accept=".json,.html"
          aria-label="파일 열기"
          onChange={loadFile}
        />
        <label>
          docparser 응답 열기
          <input
            data-testid="docparser-file"
            type="file"
            accept=".json"
            onChange={importResponse('open')}
          />
        </label>
        <label>
          커서에 삽입
          <input
            data-testid="docparser-insert-file"
            type="file"
            accept=".json"
            onChange={importResponse('insert')}
          />
        </label>
        {importInfo && <span data-testid="docparser-info">{importInfo}</span>}
        <button type="button" data-testid="theme-toggle" onClick={toggleTheme}>
          {theme === 'dark' ? '라이트' : '다크'}
        </button>
      </header>
      {error && (
        <div role="alert" className="pg-error">
          {error}
        </div>
      )}
      {report && (
        <div role="status" className="pg-error" data-testid="content-report">
          {report.fatal
            ? `열 수 없음: ${report.fatal.message}`
            : `보존된 미지원 항목 ${report.unsupported.length}개, 규칙 없는 HTML 요소 ${report.unknownHtml.length}개`}
        </div>
      )}
      <main className="pg-main">
        <section className="pg-pane">
          <EditorHost onEditor={handleEditor} onUpdate={handleUpdate} onContentReport={setReport} />
        </section>
        <section className="pg-pane pg-views">
          <h2>JSON</h2>
          {/* tabIndex: scrollable regions need keyboard access (axe scrollable-region-focusable). */}
          <pre data-testid="json-view" tabIndex={0}>
            {json}
          </pre>
          <h2>HTML</h2>
          <pre data-testid="html-view" tabIndex={0}>
            {html}
          </pre>
        </section>
      </main>
    </div>
  );
}
