import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { JSONContent } from '@tiptap/core';
import { PrintPreview } from '../../src/react';
import { paginatePrintBlocks } from '../../src/react/print/paginate';
import type { PaginateBlock } from '../../src/react/print/paginate';
import { renderPrintHtml } from '../../src/print/index';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// --- pure pagination plan (the split algorithm; jsdom cannot lay out the frame) ------------------

/** Slice shape of the plan: `[blockIndex, rowsFrom?, rowsTo?]` per slice. */
const planOf = (blocks: readonly PaginateBlock[], contentHeight: number) =>
  paginatePrintBlocks(blocks, contentHeight).map((page) =>
    page.slices.map((s) => [s.index, s.rowsFrom, s.rowsTo]),
  );

describe('print preview pagination plan', () => {
  it('splits blocks at block boundaries only', () => {
    expect(planOf([{ height: 200 }, { height: 200 }, { height: 200 }], 500)).toEqual([
      [
        [0, undefined, undefined],
        [1, undefined, undefined],
      ],
      [[2, undefined, undefined]],
    ]);
    // Exact fit stays one page; one px over starts a new one.
    expect(planOf([{ height: 250 }, { height: 250 }], 500)).toEqual([
      [
        [0, undefined, undefined],
        [1, undefined, undefined],
      ],
    ]);
    expect(planOf([{ height: 251 }, { height: 250 }], 500)).toEqual([
      [[0, undefined, undefined]],
      [[1, undefined, undefined]],
    ]);
  });

  it('splits a tall table between rows with the header repeated', () => {
    const table: PaginateBlock = { height: 950, headerHeight: 50, rows: Array(9).fill(100) };
    // Page 500px: header 50 + 4 rows per page; the last page gets the remaining row.
    expect(planOf([table], 500)).toEqual([[[0, 0, 4]], [[0, 4, 8]], [[0, 8, 9]]]);
  });

  it('keeps a fitting table whole and starts a split table on a fresh page when even header+row cannot fit', () => {
    const fitting: PaginateBlock = { height: 250, headerHeight: 50, rows: [100, 100] };
    expect(planOf([{ height: 200 }, fitting], 500)).toEqual([
      [
        [0, undefined, undefined],
        [1, undefined, undefined],
      ],
    ]);
    // Remaining 100px: header 50 + first row 100 > 100 → the table continues on a new page
    // (and fits there whole, as one slice).
    const tall: PaginateBlock = { height: 250, headerHeight: 50, rows: [100, 100] };
    expect(planOf([{ height: 400 }, tall], 500)).toEqual([
      [[0, undefined, undefined]],
      [[1, 0, 2]],
    ]);
    // Enough room for header + first row in the remainder: the first slice stays on the page.
    expect(planOf([{ height: 300 }, tall], 500)).toEqual([
      [
        [0, undefined, undefined],
        [1, 0, 1],
      ],
      [[1, 1, 2]],
    ]);
  });

  it('pageBreak forces a new page', () => {
    expect(
      planOf([{ height: 100 }, { height: 0, breakAfter: true }, { height: 100 }], 500),
    ).toEqual([
      [
        [0, undefined, undefined],
        [1, undefined, undefined],
      ],
      [[2, undefined, undefined]],
    ]);
    // `breakAfter` on a regular block ends its page too (`break-after: page`).
    expect(planOf([{ height: 300, breakAfter: true }, { height: 100 }], 500)).toEqual([
      [[0, undefined, undefined]],
      [[1, undefined, undefined]],
    ]);
  });

  it('places a block taller than a whole page alone (clipped)', () => {
    expect(planOf([{ height: 50 }, { height: 2000 }, { height: 50 }], 500)).toEqual([
      [[0, undefined, undefined]],
      [[1, undefined, undefined]],
      [[2, undefined, undefined]],
    ]);
    // A row taller than a page is also placed alone rather than dropped.
    expect(planOf([{ height: 900, headerHeight: 0, rows: [900] }], 500)).toEqual([[[0, 0, 1]]]);
  });

  it('an empty document yields one empty page', () => {
    expect(planOf([], 500)).toEqual([[]]); // one page, no slices
  });

  it('a trailing pageBreak adds no blank page', () => {
    expect(planOf([{ height: 100, breakAfter: true }], 500)).toEqual([[[0, undefined, undefined]]]);
  });
});

// --- component (toolbar / export; jsdom cannot lay out the iframe) ------------------------------

const doc: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: '표본 문단' }] }],
};

function frameOf(container: HTMLElement): HTMLIFrameElement {
  const frame = container.querySelector<HTMLIFrameElement>('[data-testid="rcm-print-frame"]');
  if (!frame) throw new Error('missing rcm-print-frame');
  return frame;
}

const click = (el: HTMLElement) => fireEvent.click(el);

describe('print preview toolbar', () => {
  it('renders the toolbar, page count, zoom toggles and the sandboxed frame', () => {
    const { container } = render(<PrintPreview doc={doc} />);
    const toolbar = container.querySelector('[data-testid="rcm-print-toolbar"]');
    expect(toolbar).toHaveAttribute('role', 'toolbar');
    expect(toolbar).toHaveAttribute('aria-label', '인쇄 미리보기 도구');
    const count = container.querySelector('[data-testid="rcm-print-page-count"]');
    expect(count).toHaveAttribute('data-count', '1'); // jsdom never paginates (no layout)
    expect(count).toHaveAttribute('aria-live', 'polite');
    const fit = container.querySelector('[data-testid="rcm-print-zoom-fit"]');
    const full = container.querySelector('[data-testid="rcm-print-zoom-100"]');
    expect(fit).toHaveAttribute('aria-pressed', 'true');
    expect(fit).toHaveAttribute('aria-label', '폭 맞춤');
    expect(fit).toHaveAttribute('title', '폭 맞춤');
    expect(full).toHaveAttribute('aria-pressed', 'false');
    expect(full).toHaveAttribute('aria-label', '100%');
    click(full as HTMLElement);
    expect(container.querySelector('[data-testid="rcm-print-zoom-100"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(container.querySelector('[data-testid="rcm-print-zoom-fit"]')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    const frame = frameOf(container);
    expect(frame).toHaveAttribute('sandbox', 'allow-same-origin');
    expect(frame.getAttribute('srcdoc')).toBe(renderPrintHtml(doc).html);
    expect(frame).toHaveAttribute('title', '인쇄 미리보기');
    expect(container.firstElementChild).toHaveClass('rcm-editor', 'rcm-print-preview');
  });

  it('merges className and injected labels', () => {
    const { container } = render(
      <PrintPreview doc={doc} className="wide" labels={{ toolbar: 'Print bar', zoomFit: 'Fit' }} />,
    );
    expect(container.firstElementChild).toHaveClass('rcm-print-preview', 'wide');
    expect(container.querySelector('[data-testid="rcm-print-toolbar"]')).toHaveAttribute(
      'aria-label',
      'Print bar',
    );
    expect(container.querySelector('[data-testid="rcm-print-zoom-fit"]')).toHaveAttribute(
      'aria-label',
      'Fit',
    );
    // Untouched keys keep their defaults.
    expect(container.querySelector('[data-testid="rcm-print-zoom-100"]')).toHaveAttribute(
      'aria-label',
      '100%',
    );
  });

  it('re-renders the frame document when doc changes', () => {
    const other: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '다른 문서' }] }],
    };
    const { container, rerender } = render(<PrintPreview doc={doc} />);
    const before = frameOf(container).getAttribute('srcdoc');
    rerender(<PrintPreview doc={other} />);
    const after = frameOf(container).getAttribute('srcdoc');
    expect(after).not.toBe(before);
    expect(after).toBe(renderPrintHtml(other).html);
  });
});

describe('print preview export', () => {
  it('hides the export button without exportPdf, shows it when given', () => {
    const { container, rerender } = render(<PrintPreview doc={doc} />);
    expect(container.querySelector('[data-testid="rcm-print-export"]')).toBeNull();
    rerender(<PrintPreview doc={doc} exportPdf={() => undefined} />);
    const button = container.querySelector<HTMLButtonElement>('[data-testid="rcm-print-export"]');
    expect(button).toHaveAttribute('aria-label', 'PDF 저장');
    expect(button).toHaveAttribute('title', 'PDF 저장');
    expect(button).not.toBeDisabled();
  });

  it('clicking export calls exportPdf exactly once with the rendered html', async () => {
    const exportPdf = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
    const { container } = render(<PrintPreview doc={doc} exportPdf={exportPdf} />);
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="rcm-print-export"]',
    ) as HTMLButtonElement;
    const html = frameOf(container).getAttribute('srcdoc');
    click(button);
    click(button); // pending: the disabled button must not fire again
    expect(exportPdf).toHaveBeenCalledTimes(1);
    expect(exportPdf).toHaveBeenCalledWith(html);
    expect(renderPrintHtml(doc).html).toBe(html); // the preview html is the print html
    await waitFor(() => expect(button).not.toBeDisabled());
    click(button);
    expect(exportPdf).toHaveBeenCalledTimes(2);
    expect(exportPdf).toHaveBeenNthCalledWith(2, html);
  });

  it('a rejected exportPdf reaches onExportError and re-enables the button', async () => {
    const failure = new Error('gotenberg down');
    const onExportError = vi.fn();
    let reject: ((error: Error) => void) | undefined;
    const { container } = render(
      <PrintPreview
        doc={doc}
        exportPdf={() =>
          new Promise<void>((_, rej) => {
            reject = rej;
          })
        }
        onExportError={onExportError}
      />,
    );
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="rcm-print-export"]',
    ) as HTMLButtonElement;
    click(button);
    expect(button).toBeDisabled();
    reject?.(failure);
    await waitFor(() => expect(onExportError).toHaveBeenCalledWith(failure));
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(console.error).not.toHaveBeenCalled();
  });
});
