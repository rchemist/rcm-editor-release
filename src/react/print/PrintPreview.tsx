import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSONContent } from '@tiptap/core';
import { renderPrintHtml } from '../../print/index';
import type { RenderPrintHtmlOptions } from '../../print/index';
import { warnIfStylesMissing } from '../styleCheck';
import { resolvePrintPreviewLabels } from './labels';
import type { RcmPrintPreviewLabels } from './labels';
import { firstFontFaceFamily, paginateFrame, watchLateImages } from './frame';

/** Late image arrivals may rebuild the preview this many times per document. */
const MAX_REBUILDS = 2;

export interface PrintPreviewProps {
  /** Document JSON (the editor's lossless JSON — `onChange` payload `json`). */
  doc: JSONContent;
  /** Print options of `renderPrintHtml()` (`page`, `margins`, `header`, `footer`, `fontCss`, …). */
  options?: RenderPrintHtmlOptions;
  /**
   * PDF export (server Chromium, `examples/pdf-server/`): called with exactly the HTML
   * the preview renders. The button is disabled while the returned promise is pending.
   */
  exportPdf?: (html: string) => Promise<void> | void;
  /** A rejected `exportPdf` lands here; without it the error is logged to the console. */
  onExportError?: (error: unknown) => void;
  /** Partial labels (Korean defaults for the rest), same mechanism as `<RcmEditor>`. */
  labels?: Partial<RcmPrintPreviewLabels>;
  /** Extra classes on the root (`.rcm-editor.rcm-print-preview`). */
  className?: string;
}

const keyIds = new WeakMap<object, number>();
let keySeq = 0;

/** JSON when the value serializes, a stable per-object id otherwise (cyclic / class instances). */
function stableKey(value: unknown, tag: string): string {
  if (value === null || typeof value !== 'object') return `${tag}:${String(value)}`;
  try {
    return `${tag}:${JSON.stringify(value) ?? 'null'}`;
  } catch {
    let id = keyIds.get(value);
    if (id === undefined) keyIds.set(value, (id = ++keySeq));
    return `${tag}:#${id}`;
  }
}

/**
 * Paged print preview: renders `renderPrintHtml(doc, options).html` in a sandboxed
 * iframe (`sandbox="allow-same-origin"`, scripts off, `srcdoc`) and re-lays it into page boxes
 * of the `@page` size with margins, header/footer bands and page numbers — a screen emulation
 * of the margin boxes the PDF server's Chromium draws. "PDF 저장" hands the same `html` to the
 * injected `exportPdf`. Pagination is an emulation (block/row splits, `thead` repeat), not a
 * print engine.
 */
export function PrintPreview({
  doc,
  options,
  exportPdf,
  onExportError,
  labels,
  className,
}: PrintPreviewProps) {
  const resolved = resolvePrintPreviewLabels(labels);
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);

  // `renderPrintHtml()` runs the schema + serializer: memo on the serialized inputs so inline
  // object literals in JSX (`options={{ ... }}`) do not re-render the whole document. The
  // refs feed the memo the current values; the serialized keys decide when to recompute.
  const docKey = stableKey(doc, 'doc');
  const optionsKey = stableKey(options, 'options');
  const docRef = useRef(doc);
  docRef.current = doc;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const html = useMemo(
    () => renderPrintHtml(docRef.current ?? { type: 'doc' }, optionsRef.current).html,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the serialized doc/options above
    [docKey, optionsKey],
  );

  const [pageCount, setPageCount] = useState(1);
  const [surface, setSurface] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState<'fit' | 'full'>('fit');
  const [exporting, setExporting] = useState(false);
  const genRef = useRef(0);
  const rebuildsRef = useRef(0);
  const pendingRef = useRef(false);

  const htmlRef = useRef(html);
  htmlRef.current = html;

  useEffect(() => {
    if (rootRef.current) warnIfStylesMissing(rootRef.current);
  }, []);

  // New document: a fresh pagination budget for late images.
  useEffect(() => {
    rebuildsRef.current = 0;
  }, [html]);

  const handleLoad = useCallback(() => {
    const gen = ++genRef.current;
    const frame = frameRef.current;
    if (!frame) return;
    const opts = optionsRef.current ?? {};
    void (async () => {
      const result = await paginateFrame(
        frame,
        opts,
        firstFontFaceFamily(opts.fontCss),
        () => genRef.current !== gen,
      );
      if (!result || genRef.current !== gen || frameRef.current !== frame) return;
      setPageCount((prev) => (prev === result.pages ? prev : result.pages));
      setSurface((prev) =>
        prev && prev.w === result.width && prev.h === result.height
          ? prev
          : { w: result.width, h: result.height },
      );
      watchLateImages(
        frame,
        htmlRef.current,
        () => MAX_REBUILDS - rebuildsRef.current,
        () => {
          rebuildsRef.current++;
        },
      );
    })();
  }, []);

  // Fit-width needs the viewport width of the scroll view (ResizeObserver where available).
  const [viewWidth, setViewWidth] = useState(0);
  useLayoutEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const update = () => setViewWidth((prev) => (prev === el.clientWidth ? prev : el.clientWidth));
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scale =
    zoom === 'full' || !surface || surface.w <= 0 || viewWidth <= 0
      ? 1
      : Math.min(4, Math.max(0.1, (viewWidth - 16) / surface.w));

  // The latest error callback without re-binding the export handler.
  const onExportErrorRef = useRef(onExportError);
  onExportErrorRef.current = onExportError;

  const handleExport = useCallback(() => {
    if (pendingRef.current || !exportPdf) return;
    pendingRef.current = true;
    setExporting(true);
    void (async () => {
      try {
        await exportPdf(htmlRef.current);
      } catch (error) {
        if (onExportErrorRef.current) onExportErrorRef.current(error);
        else console.error('PrintPreview: exportPdf failed', error);
      } finally {
        pendingRef.current = false;
        setExporting(false);
      }
    })();
  }, [exportPdf]);

  const count = resolved.pageCount.replace(/\{pages\}/g, String(pageCount));

  return (
    <div
      ref={rootRef}
      className={
        className ? `rcm-editor rcm-print-preview ${className}` : 'rcm-editor rcm-print-preview'
      }
      data-testid="rcm-print-preview"
    >
      <div
        className="rcm-tb"
        role="toolbar"
        aria-label={resolved.toolbar}
        data-testid="rcm-print-toolbar"
      >
        <span
          className="rcm-tb-entry rcm-print-count"
          data-testid="rcm-print-page-count"
          data-count={pageCount}
          aria-live="polite"
        >
          {count}
        </span>
        <span className="rcm-tb-sep" aria-hidden="true" />
        <button
          type="button"
          className="rcm-tb-btn"
          data-testid="rcm-print-zoom-fit"
          aria-pressed={zoom === 'fit'}
          aria-label={resolved.zoomFit}
          title={resolved.zoomFit}
          onClick={() => setZoom('fit')}
        >
          {resolved.zoomFit}
        </button>
        <button
          type="button"
          className="rcm-tb-btn"
          data-testid="rcm-print-zoom-100"
          aria-pressed={zoom === 'full'}
          aria-label={resolved.zoom100}
          title={resolved.zoom100}
          onClick={() => setZoom('full')}
        >
          {resolved.zoom100}
        </button>
        {exportPdf && (
          <>
            <span className="rcm-tb-sep" aria-hidden="true" />
            <button
              type="button"
              className="rcm-tb-btn"
              data-testid="rcm-print-export"
              aria-label={resolved.export}
              title={resolved.export}
              disabled={exporting}
              onClick={handleExport}
            >
              {resolved.export}
            </button>
          </>
        )}
      </div>
      {/* tabIndex: the scrollable preview pane needs keyboard access (axe scrollable-region-focusable). */}
      <div className="rcm-print-view" ref={viewRef} tabIndex={0}>
        <div
          className="rcm-print-sizer"
          style={surface ? { width: surface.w * scale, height: surface.h * scale } : undefined}
        >
          <iframe
            ref={frameRef}
            title={resolved.preview}
            sandbox="allow-same-origin"
            srcDoc={html}
            onLoad={handleLoad}
            data-testid="rcm-print-frame"
            className="rcm-print-frame"
            style={
              surface
                ? { width: surface.w, height: surface.h, transform: `scale(${scale})` }
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
