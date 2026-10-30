// Iframe-side machinery of `<PrintPreview>`: resolve the `@page` box into px, measure the
// print body's top-level blocks, then re-lay them into page boxes inside the sandboxed frame
// (screen emulation of the `@page` margin boxes). DOM only — no React — and guarded: without
// layout (jsdom, a missing print body) nothing measures and the frame keeps the unpaginated
// document the `srcdoc` carries.

import type { PrintLayoutOptions, PrintMargins } from '../../print/index';
import { paginatePrintBlocks } from './paginate';
import type { PaginatePage, PaginateSlice } from './paginate';

/** Named pages of `PrintPage` as CSS lengths. */
const NAMED_PAGES: Record<string, { width: string; height: string }> = {
  A4: { width: '210mm', height: '297mm' },
  Letter: { width: '8.5in', height: '11in' },
};

/** How long fonts/images may hold pagination back before the preview gives up waiting (ms). */
const SETTLE_TIMEOUT_MS = 4000;

export interface PrintPreviewLayout {
  pageWidth: number;
  pageHeight: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  /** `@page` box minus margins — what the paginated content may fill. */
  contentWidth: number;
  contentHeight: number;
}

/** `210mm` → px, measured with a probe in `doc` (the frame's own CSS px). */
function cssLengthPx(doc: Document, length: string): number {
  const probe = doc.createElement('div');
  probe.style.cssText = `position:absolute;top:0;left:0;width:${length};height:0;visibility:hidden;`;
  doc.body.appendChild(probe);
  const px = probe.getBoundingClientRect().width;
  probe.remove();
  return Number.isFinite(px) ? px : 0;
}

/** Per-side margins from a `PrintMargins` (CSS shorthand of 1–4 values, or the object form). */
function marginsOf(margins: PrintMargins | undefined): [string, string, string, string] {
  if (typeof margins === 'object' && margins)
    return [margins.top, margins.right, margins.bottom, margins.left];
  const parts = (margins ?? '').trim().split(/\s+/).filter(Boolean);
  const at = (i: number): string => parts[i] ?? '20mm';
  switch (parts.length) {
    case 1:
      return [at(0), at(0), at(0), at(0)];
    case 2:
      return [at(0), at(1), at(0), at(1)];
    case 3:
      return [at(0), at(1), at(2), at(1)];
    default:
      return [at(0), at(1), at(2), at(3)];
  }
}

/** Resolves the `@page` size/margins of `options` into px inside `doc`. */
export function resolvePrintPreviewLayout(
  doc: Document,
  options: PrintLayoutOptions,
): PrintPreviewLayout {
  const named = NAMED_PAGES[options.page as string];
  const size =
    options.page && typeof options.page === 'object'
      ? options.page
      : { width: named?.width ?? '210mm', height: named?.height ?? '297mm' };
  const [top, right, bottom, left] = marginsOf(options.margins);
  const marginTop = cssLengthPx(doc, top);
  const marginRight = cssLengthPx(doc, right);
  const marginBottom = cssLengthPx(doc, bottom);
  const marginLeft = cssLengthPx(doc, left);
  const pageWidth = cssLengthPx(doc, size.width);
  const pageHeight = cssLengthPx(doc, size.height);
  return {
    pageWidth,
    pageHeight,
    marginTop,
    marginRight,
    marginBottom,
    marginLeft,
    contentWidth: pageWidth - marginLeft - marginRight,
    contentHeight: pageHeight - marginTop - marginBottom,
  };
}

/** First `font-family` an `@font-face` rule in `fontCss` declares, unquoted (margin-box font). */
export function firstFontFaceFamily(fontCss: string | undefined): string | null {
  if (!fontCss) return null;
  const match = /@font-face\s*{[^}]*?font-family\s*:\s*(['"]?)([^;'"}]+)\1/i.exec(fontCss);
  return match?.[2]?.trim() || null;
}

/** A measured block: the pure pagination input plus the elements it was measured from. */
export interface MeasuredBlock {
  /** Flow space the block consumes (px), collapsed margins included. */
  height: number;
  headerHeight?: number;
  rows?: number[];
  breakAfter?: boolean;
  /** The top-level element (child of `.ProseMirror`). */
  el: HTMLElement;
  /** Tables: the `table` this block carries (directly, or inside its `tableWrapper`). */
  table?: HTMLTableElement;
  /** Tables: the measured `tbody` row elements, moved into the page slices. */
  rowEls?: Element[];
}

/**
 * Space each element consumes in flow: the distance to the next element's top (collapsed
 * margins included); the last one adds its own height + bottom margin. (`getBoundingClientRect`
 * deltas keep this stable under margin collapsing, which per-element heights would not.)
 */
function flowHeights(win: Window, els: readonly HTMLElement[]): number[] {
  const rects = els.map((el) => el.getBoundingClientRect());
  const margins = els.map((el) => parseFloat(win.getComputedStyle(el).marginBottom) || 0);
  return rects.map((rect, i) => {
    const next = rects[i + 1];
    return next ? Math.max(next.top - rect.top, 0) : rect.height + (margins[i] ?? 0);
  });
}

/** Measures the top-level blocks of the print body (`.rcm-editor .ProseMirror`). */
export function measurePrintBlocks(win: Window, content: HTMLElement): MeasuredBlock[] {
  const kids = Array.from(content.children).filter((el) => el.nodeType === 1) as HTMLElement[];
  const heights = flowHeights(win, kids);
  return kids.map((el, i) => {
    const style = win.getComputedStyle(el);
    const block: MeasuredBlock = {
      el,
      height: heights[i] ?? 0,
      breakAfter:
        el.getAttribute('data-type') === 'page-break' ||
        style.breakAfter === 'page' ||
        style.pageBreakAfter === 'always',
    };
    const table = (
      el.tagName === 'TABLE' ? el : el.querySelector(':scope > table')
    ) as HTMLTableElement | null;
    if (table?.tBodies.length) {
      const rowEls = Array.from(table.tBodies)
        .flatMap((body) => Array.from(body.children))
        .filter((row) => row.nodeType === 1 && row.tagName === 'TR');
      if (rowEls.length) {
        block.table = table;
        block.rowEls = rowEls;
        block.rows = flowHeights(win, rowEls as HTMLElement[]);
        block.headerHeight = table.tHead ? table.tHead.getBoundingClientRect().height : 0;
      }
    }
    return block;
  });
}

/** `{page}`/`{pages}` → numbers (the same tokens the footer margin box supports). */
function marginText(template: string, page: number, pages: number): string {
  return template.replace(/\{page\}/g, String(page)).replace(/\{pages\}/g, String(pages));
}

/** Preview chrome CSS injected into the frame (the pages stay white paper on a viewer grey). */
function previewCss(marginFamily: string | null): string {
  const font = marginFamily ? `font-family:'${marginFamily.replaceAll("'", '')}',sans-serif;` : '';
  return (
    'html,body{margin:0 !important;padding:0 !important;background:#525659;}\n' +
    // The stage defines its own width (widest page + padding); the canvas stays grey around it.
    'body{width:max-content !important;margin:0 auto !important;}\n' +
    // The `.rcm-editor` root keeps the print typography but stops painting its white box.
    '.rcm-editor{background:transparent;}\n' +
    '.rcm-print-stage{display:flex;flex-direction:column;align-items:center;gap:18px;padding:18px 10px;}\n' +
    '.rcm-print-page{position:relative;box-sizing:border-box;flex:none;background:#fff;' +
    'box-shadow:0 1px 4px rgb(0 0 0 / 40%);overflow:hidden;}\n' +
    `.rcm-print-margin{position:absolute;left:0;right:0;display:flex;align-items:center;` +
    `justify-content:center;overflow:hidden;color:#000;font-size:12px;line-height:1.4;` +
    `white-space:nowrap;${font}}\n` +
    // Paged media truncate adjoining margins at page breaks; the flow boxes mirror that.
    '.rcm-print-content{position:relative;}\n' +
    '.rcm-print-content>:first-child{margin-top:0 !important;}\n' +
    '.rcm-print-content>:last-child{margin-bottom:0 !important;}\n' +
    // The break marker is an editor affordance; the PDF page itself shows nothing.
    "[data-type='page-break']{display:none !important;}\n"
  );
}

function appendSlice(
  doc: Document,
  flow: HTMLElement,
  blocks: readonly MeasuredBlock[],
  slice: PaginateSlice,
): void {
  const block = blocks[slice.index];
  if (!block) return;
  if (block.table && slice.rowsTo !== undefined && block.rowEls) {
    // Table slice: the wrapper (or a plain div for a bare table) with the table shell —
    // colgroup and thead cloned so columns repeat — and this page's rows moved in.
    const host =
      block.el.tagName === 'TABLE'
        ? doc.createElement('div')
        : (block.el.cloneNode(false) as HTMLElement);
    const shell = block.table.cloneNode(false) as HTMLTableElement;
    const colgroup = block.table.querySelector('colgroup');
    if (colgroup) shell.appendChild(colgroup.cloneNode(true));
    if (block.table.tHead) shell.appendChild(block.table.tHead.cloneNode(true));
    const sourceBody = block.table.tBodies[0];
    if (!sourceBody) return;
    const body = sourceBody.cloneNode(false) as HTMLTableSectionElement;
    for (let r = slice.rowsFrom ?? 0; r < slice.rowsTo; r++) {
      const row = block.rowEls[r];
      if (row) body.appendChild(row); // move: each row ends up on exactly one page
    }
    shell.appendChild(body);
    host.appendChild(shell);
    flow.appendChild(host);
    return;
  }
  flow.appendChild(block.el);
}

export interface BuildPagesInput {
  layout: PrintPreviewLayout;
  blocks: readonly MeasuredBlock[];
  pages: readonly PaginatePage[];
  /** Header template (plain text) drawn in each page's top margin band. */
  header?: string;
  /** Footer template (`{page}`/`{pages}` tokens) drawn in each page's bottom margin band. */
  footer?: string;
  /** First `@font-face` family of `fontCss`, for the margin-box text font. */
  marginFamily: string | null;
}

/**
 * Re-lays the framed print document into page boxes (a previous pass, if any, is dropped).
 * Blocks are moved inside `.ProseMirror`, so every `.rcm-editor …` content rule keeps
 * applying to them — only the page boxes are new.
 */
export function buildPrintPages(doc: Document, input: BuildPagesInput): void {
  const content = doc.querySelector<HTMLElement>('.rcm-editor .ProseMirror');
  if (!content) return;
  content.querySelector('[data-rcm-print-stage]')?.remove();
  doc.querySelector('style[data-rcm-print-preview]')?.remove();

  const style = doc.createElement('style');
  style.setAttribute('data-rcm-print-preview', '');
  style.textContent = previewCss(input.marginFamily);
  doc.head.appendChild(style);

  const { layout, blocks, pages, header, footer } = input;
  const stage = doc.createElement('div');
  stage.className = 'rcm-print-stage';
  stage.setAttribute('data-rcm-print-stage', '');

  pages.forEach((page, index) => {
    const box = doc.createElement('div');
    box.className = 'rcm-print-page';
    box.setAttribute('data-testid', 'rcm-print-page');
    box.style.width = `${layout.pageWidth}px`;
    box.style.height = `${layout.pageHeight}px`;
    box.style.padding = `${layout.marginTop}px ${layout.marginRight}px ${layout.marginBottom}px ${layout.marginLeft}px`;
    if (header) {
      const band = doc.createElement('div');
      band.className = 'rcm-print-margin rcm-print-margin-top';
      band.style.top = '0';
      band.style.height = `${layout.marginTop}px`;
      band.textContent = marginText(header, index + 1, pages.length);
      box.appendChild(band);
    }
    if (footer) {
      const band = doc.createElement('div');
      band.className = 'rcm-print-margin rcm-print-margin-bottom';
      band.style.bottom = '0';
      band.style.height = `${layout.marginBottom}px`;
      band.textContent = marginText(footer, index + 1, pages.length);
      box.appendChild(band);
    }
    const flow = doc.createElement('div');
    flow.className = 'rcm-print-content';
    for (const slice of page.slices) appendSlice(doc, flow, blocks, slice);
    box.appendChild(flow);
    stage.appendChild(box);
  });

  content.appendChild(stage);
  // Split tables leave their (now emptied) original block behind — drop what did not move
  // into the stage so the unpaginated remnant cannot show under the pages.
  for (const block of blocks) {
    if (!block.el.closest('[data-rcm-print-stage]')) block.el.remove();
  }
}

export interface PaginateFrameResult {
  pages: number;
  /** Laid-out stage size (px) — the iframe content size the parent scales for zoom. */
  width: number;
  height: number;
}

/** Waits for the fonts and images the layout depends on, bounded by `timeoutMs`. */
async function settle(doc: Document, timeoutMs: number): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts) jobs.push(fonts.ready.catch(() => undefined));
  if (Array.from(doc.images).some((img) => !img.complete)) {
    jobs.push(
      new Promise<void>((resolve) => {
        const check = () => {
          if (!Array.from(doc.images).every((img) => img.complete)) return;
          doc.removeEventListener('load', check, true);
          doc.removeEventListener('error', check, true);
          resolve();
        };
        doc.addEventListener('load', check, true);
        doc.addEventListener('error', check, true);
        check();
      }),
    );
  }
  await Promise.race([
    Promise.all(jobs),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/**
 * Paginates the document of `frame` (the `srcdoc` produced by `renderPrintHtml()`): settle →
 * resolve the `@page` box → measure at the content width → plan → build page boxes. Returns
 * `null` (frame untouched) when the frame has no layout or no print body, or when `isStale()`
 * says a newer run has taken over.
 */
export async function paginateFrame(
  frame: HTMLIFrameElement | null,
  options: PrintLayoutOptions,
  marginFamily: string | null,
  isStale: () => boolean,
): Promise<PaginateFrameResult | null> {
  const doc = frame?.contentDocument;
  if (!doc?.body) return null;
  const content = doc.querySelector<HTMLElement>('.rcm-editor .ProseMirror');
  const win = doc.defaultView;
  if (!content || !win) return null;

  await settle(doc, SETTLE_TIMEOUT_MS);
  if (isStale() || frame?.contentDocument !== doc) return null;

  const layout = resolvePrintPreviewLayout(doc, options);
  if (
    layout.pageWidth <= 0 ||
    layout.pageHeight <= 0 ||
    layout.contentWidth <= 0 ||
    layout.contentHeight <= 0
  )
    return null;

  // Measure at exactly the content width: a style element, removed again before building.
  const measure = doc.createElement('style');
  measure.setAttribute('data-rcm-print-measure', '');
  measure.textContent = `html,body{margin:0 !important;padding:0 !important;}body{width:${layout.contentWidth}px;}`;
  doc.head.appendChild(measure);
  const blocks = measurePrintBlocks(win, content);
  measure.remove();
  if (isStale() || frame?.contentDocument !== doc) return null;

  const pages = paginatePrintBlocks(blocks, layout.contentHeight);
  buildPrintPages(doc, {
    layout,
    blocks,
    pages,
    header: options.header,
    footer: options.footer,
    marginFamily,
  });
  // The laid-out stage is the iframe surface the parent scales for zoom (its own box: the
  // pages, gaps and padding — independent of the iframe viewport it happens to sit in).
  const rect = doc.querySelector('[data-rcm-print-stage]')?.getBoundingClientRect();
  return {
    pages: pages.length,
    width: Math.ceil(rect?.width ?? 0),
    height: Math.ceil(rect?.height ?? 0),
  };
}

/**
 * Rebuilds the preview when an image settles after pagination (it changes the flow). Bounded
 * by `budget()`: a permanently broken source must not churn the frame forever.
 */
export function watchLateImages(
  frame: HTMLIFrameElement,
  html: string,
  budget: () => number,
  spend: () => void,
): void {
  const doc = frame.contentDocument;
  if (!doc) return;
  const onSettle = (event: Event) => {
    if ((event.target as Element | null)?.tagName !== 'IMG') return;
    doc.removeEventListener('load', onSettle, true);
    doc.removeEventListener('error', onSettle, true);
    if (budget() <= 0) return;
    spend();
    // Full reload of the same HTML: the load handler re-paginates with the image settled.
    frame.setAttribute('srcdoc', html);
  };
  doc.addEventListener('load', onSettle, true);
  doc.addEventListener('error', onSettle, true);
}
