/**
 * Labels of `<PrintPreview>`. Same mechanism as `RcmEditorLabels`: injected labels
 * override per key (non-empty strings only), every UI string of the component comes from here.
 */
export interface RcmPrintPreviewLabels {
  /** Accessible name of the toolbar (`role="toolbar"`). */
  toolbar: string;
  /** Page count phrase; `{pages}` is replaced with the number of pages. */
  pageCount: string;
  /** "Fit width" zoom toggle. */
  zoomFit: string;
  /** "100%" zoom toggle. */
  zoom100: string;
  /** "Save PDF" button (rendered only when `exportPdf` is given). */
  export: string;
  /** Accessible name (`title`) of the preview iframe. */
  preview: string;
}

export const DEFAULT_PRINT_PREVIEW_LABELS: RcmPrintPreviewLabels = {
  toolbar: '인쇄 미리보기 도구',
  pageCount: '{pages}쪽',
  zoomFit: '폭 맞춤',
  zoom100: '100%',
  export: 'PDF 저장',
  preview: '인쇄 미리보기',
};

/** Defaults with the non-empty injected labels on top. */
export function resolvePrintPreviewLabels(
  labels: Partial<RcmPrintPreviewLabels> | undefined,
): RcmPrintPreviewLabels {
  const out = { ...DEFAULT_PRINT_PREVIEW_LABELS };
  if (!labels) return out;
  for (const key of Object.keys(out) as (keyof RcmPrintPreviewLabels)[]) {
    const value = labels[key];
    if (typeof value === 'string' && value !== '') out[key] = value;
  }
  return out;
}
