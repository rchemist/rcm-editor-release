// Pagination plan for the print preview — pure: measured heights in, pages out, no DOM.
// Measurement happens in the preview iframe (`frame.ts`); this module stays layout-free so the
// split rules are unit-testable headless. The plan emulates what Chromium's print fragmentation
// does on the PDF server (split at block boundaries, `tr` never splitting, `thead` repeating) —
// it is not a layout engine.

/** A measured top-level block of the print body (`div.rcm-editor > div.ProseMirror > *`). */
export interface PaginateBlock {
  /**
   * Vertical space the block consumes in flow (px): the distance to the next block's top
   * (collapsed margins included); the last block adds its own height + bottom margin.
   */
  height: number;
  /** Table only: `thead` height, repeated on every page a split table continues on. */
  headerHeight?: number;
  /** Table only: body-row heights (same flow-space convention); rows never split. */
  rows?: number[];
  /** `pageBreak` node (or `break-after: page`): the following block starts a new page. */
  breakAfter?: boolean;
}

/** A block placed on a page; a split table contributes one slice per page. */
export interface PaginateSlice {
  /** Index into the measured blocks. */
  index: number;
  /** Split tables only: body-row range `[rowsFrom, rowsTo)` placed on this page. */
  rowsFrom?: number;
  rowsTo?: number;
}

/** One page's slices, in document order. */
export interface PaginatePage {
  slices: PaginateSlice[];
}

/** Rows of `rows[from:]` fitting into `avail` px. Always ≥ 1: a row taller than a whole page
 *  is placed alone (clipped), like any other unsplittable block. */
function rowsFitting(rows: readonly number[], from: number, avail: number): number {
  let used = 0;
  let count = 0;
  for (let i = from; i < rows.length; i++) {
    const height = Math.max(rows[i] ?? 0, 0);
    if (count > 0 && used + height > avail) break;
    used += height;
    count++;
  }
  return count;
}

const rowsSum = (rows: readonly number[], from: number, to: number): number => {
  let out = 0;
  for (let i = from; i < to; i++) out += Math.max(rows[i] ?? 0, 0);
  return out;
};

/**
 * Splits measured blocks into pages of `contentHeight` px (the `@page` box minus its margins).
 *
 * - Blocks split only at block boundaries; a block taller than a whole page sits alone on its
 *   own page (visually clipped — noted in the spec).
 * - A table taller than the remaining space splits between rows; `thead` repeats on every
 *   continuation page; a row taller than a whole page sits alone (clipped).
 * - `breakAfter` (`pageBreak`) ends its page.
 * - An empty document yields one empty page (a preview always shows at least one page).
 */
export function paginatePrintBlocks(
  blocks: readonly PaginateBlock[],
  contentHeight: number,
): PaginatePage[] {
  const pages: PaginatePage[] = [];
  let slices: PaginateSlice[] = [];
  let used = 0;
  const flush = () => {
    pages.push({ slices });
    slices = [];
    used = 0;
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i] as PaginateBlock;
    const height = Math.max(block.height, 0);
    const rows = block.rows ?? [];
    const header = Math.max(block.headerHeight ?? 0, 0);
    const remaining = contentHeight - used;

    if (rows.length > 0 && height > remaining) {
      // Split the table between rows; the header repeats on every continuation page.
      let from = 0;
      // Not even header + first row fits in the remainder: continue on a fresh page.
      if (used > 0 && header + Math.max(rows[0] ?? 0, 0) > remaining) flush();
      while (from < rows.length) {
        const avail = Math.max(contentHeight - used - header, 0);
        const count = rowsFitting(rows, from, avail);
        slices.push({ index: i, rowsFrom: from, rowsTo: from + count });
        used += header + rowsSum(rows, from, from + count);
        from += count;
        if (from < rows.length) flush();
      }
    } else {
      // Plain block, or a table that fits in the remaining space.
      if (used > 0 && height > remaining) flush();
      slices.push({ index: i });
      used += height;
      // Taller than a whole page: nothing fits after it — it sits alone (clipped).
      if (height > contentHeight) flush();
    }

    if (block.breakAfter) flush();
  }

  // A trailing `pageBreak` must not add a blank page after the last content page.
  if (slices.length > 0 || pages.length === 0) flush();
  return pages;
}
