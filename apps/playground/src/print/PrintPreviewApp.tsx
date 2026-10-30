// 인쇄 미리보기 테스트 페이지: 다쪽 표 표본을 <PrintPreview>로 띄운다.
// e2e 훅: window.__rcmPrint.html = 이 페이지가 기대하는 인쇄 HTML(renderPrintHtml 결과),
// window.__rcmExportCalls = "PDF 저장"이 주입한 exportPdf에 넘긴 인자 목록.
import { useEffect, useMemo } from 'react';
import { PrintPreview } from '@rchemist/editor/react';
import { renderPrintHtml } from '@rchemist/editor/print';

type Doc = Parameters<typeof renderPrintHtml>[0];

const ROWS = 80;
const COLUMNS = 3;

/** 다쪽 표 표본: 제목·문단, 강제 쪽바꿈, 머리 행 + 80행 표. */
function sampleDoc(): Doc {
  const cell = (type: string, text: string) => ({
    type,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });
  const header = {
    type: 'tableRow',
    content: Array.from({ length: COLUMNS }, (_, c) => cell('tableHeader', `머리 ${c + 1}`)),
  };
  const rows = Array.from({ length: ROWS }, (_, r) => ({
    type: 'tableRow',
    content: Array.from({ length: COLUMNS }, (_, c) => cell('tableCell', `행 ${r + 1}-${c + 1}`)),
  }));
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: '인쇄 미리보기 표본' }],
      },
      { type: 'paragraph', content: [{ type: 'text', text: '표 80행짜리 다쪽 문서 표본이다.' }] },
      { type: 'pageBreak' },
      { type: 'table', content: [header, ...rows] },
    ],
  };
}

const options = {
  page: 'A4' as const,
  margins: '20mm',
  header: 'RCM 인쇄 미리보기',
  footer: '{page} / {pages}',
  // Non-empty document title (axe document-title); the empty default is only for API tests.
  title: 'RCM 인쇄 미리보기',
};

declare global {
  interface Window {
    /** e2e hook: the print HTML this page expects the preview to render. */
    __rcmPrint?: { html: string };
    /** e2e hook: every html the injected exportPdf received. */
    __rcmExportCalls?: string[];
  }
}

export function PrintPreviewApp() {
  const doc = useMemo(sampleDoc, []);
  const html = useMemo(() => renderPrintHtml(doc, options).html, [doc]);

  useEffect(() => {
    window.__rcmPrint = { html };
    window.__rcmExportCalls = [];
  }, [html]);

  const exportPdf = (received: string) => {
    window.__rcmExportCalls?.push(received);
  };

  return (
    <main className="pg">
      <PrintPreview
        doc={doc}
        options={options}
        exportPdf={exportPdf}
        className="pg-print-preview"
      />
    </main>
  );
}
