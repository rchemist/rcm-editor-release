import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

function outerWidth(el: HTMLElement): number {
  const style = getComputedStyle(el);
  return (
    el.getBoundingClientRect().width +
    (parseFloat(style.marginLeft) || 0) +
    (parseFloat(style.marginRight) || 0)
  );
}

/** Entries that fit in `avail` next to a "more" button of width `moreWidth`. */
export function fitCount(
  widths: readonly number[],
  avail: number,
  gap: number,
  moreWidth: number,
): number {
  const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, widths.length - 1);
  if (total <= avail) return widths.length;
  let used = moreWidth;
  let count = 0;
  for (const width of widths) {
    const next = used + gap + width;
    if (next > avail) break;
    used = next;
    count++;
  }
  return count;
}

/**
 * How many leading entries stay on the bar. All entries are rendered first and measured; the
 * widths are cached, so later resizes only recompute. Without layout (jsdom, hidden, no
 * ResizeObserver) everything stays visible. Disabled (`overflow: 'wrap'`), nothing is measured
 * and everything stays visible.
 */
export function useOverflow(
  barRef: RefObject<HTMLElement | null>,
  key: string,
  count: number,
  enabled = true,
): number {
  const [fit, setFit] = useState<{ key: string; n: number } | null>(null);
  const cache = useRef<{ key: string; widths: number[] } | null>(null);
  const fitRef = useRef(fit);
  fitRef.current = fit;

  const run = useCallback(() => {
    const bar = barRef.current;
    if (!enabled || !bar || bar.clientWidth === 0) return;
    const style = getComputedStyle(bar);
    const entries = Array.from(bar.querySelectorAll<HTMLElement>(':scope > [data-rcm-entry]'));
    const isMore = (el: HTMLElement) => el.hasAttribute('data-rcm-more');
    const items = entries.filter((el) => !isMore(el));
    if (items.length === count && !entries.some(isMore)) {
      cache.current = { key, widths: items.map(outerWidth) };
    }
    const measured = cache.current;
    if (!measured || measured.key !== key) return;

    const gap = parseFloat(style.columnGap) || 0;
    const pad = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const slots = Array.from(bar.querySelectorAll<HTMLElement>(':scope > .rcm-tb-slot'));
    const slotWidth = slots.reduce((sum, el) => sum + outerWidth(el) + gap, 0);
    const moreWidth = parseFloat(style.getPropertyValue('--rcm-tb-btn-size')) || 32;
    const avail = bar.clientWidth - pad - slotWidth;
    const n = fitCount(measured.widths, avail, gap, moreWidth);
    setFit((prev) => (prev && prev.key === key && prev.n === n ? prev : { key, n }));
  }, [barRef, key, count, enabled]);

  // Every commit: while all entries are rendered (fit unknown) this measures them.
  useLayoutEffect(() => {
    run();
  });

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => run());
    observer.observe(bar);
    return () => observer.disconnect();
  }, [barRef, run]);

  return enabled && fit && fit.key === key ? fit.n : count;
}
