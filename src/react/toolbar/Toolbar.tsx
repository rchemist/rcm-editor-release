import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import type { RcmEditorLabels } from '../labels';
import type { RcmFontOption } from '../RcmEditor';
import { BuiltinControl, CustomControl } from './controls';
import type { ControlContext } from './controls';
import { MORE_ICON } from './icons';
import { DEFAULT_FONTS, computeState, entriesKey, resolveEntries } from './items';
import type { ItemState, ResolvedEntry } from './items';
import { usePopup } from './popup';
import type { RcmToolbarConfig } from './types';
import { useOverflow } from './useOverflow';

export interface ToolbarProps {
  editor: Editor;
  labels: RcmEditorLabels;
  config: RcmToolbarConfig;
  fonts?: readonly RcmFontOption[];
  /** Opens the find & replace panel; the `find` item is omitted without it. */
  onFind?: () => void;
  /** Toggles the HTML source mode; the `source` item is omitted without it. */
  onSourceToggle?: () => void;
  /** The HTML source mode is active (the `source` toggle shows `aria-pressed`). */
  sourceActive?: boolean;
}

const EMPTY_STATE: ItemState = { a: false, d: false, v: '' };

export function Toolbar({
  editor,
  labels,
  config,
  fonts,
  onFind,
  onSourceToggle,
  sourceActive,
}: ToolbarProps) {
  // Re-resolved on every render, not memoized: `available` items (e.g. `file`) read mutable
  // editor state — a handler wired in after mount (the React `uploadFile` prop) must show up
  // in the same render that adds it. Cheap either way (a pass over ~30 config entries).
  const entries = resolveEntries(config, editor);
  const key = entriesKey(entries);
  const barRef = useRef<HTMLDivElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const closeMore = useCallback(() => setMoreOpen(false), []);

  const states = useEditorState({
    editor,
    selector: ({ editor: e }) => computeState(e, entries),
  });

  const wrap = config.overflow === 'wrap';
  const visible = useOverflow(barRef, key, entries.length, !wrap);
  const shown = useMemo(() => {
    const head = entries.slice(0, visible);
    while (head[head.length - 1]?.type === 'sep') head.pop();
    return head.map((entry, index) => ({ entry, index }));
  }, [entries, visible]);
  const hidden = useMemo(() => {
    if (visible >= entries.length) return [];
    const tail = entries.slice(visible).map((entry, i) => ({ entry, index: visible + i }));
    while (tail[0]?.entry.type === 'sep') tail.shift();
    return tail;
  }, [entries, visible]);

  const ctxMain: ControlContext = {
    editor,
    labels,
    fonts: fonts ?? DEFAULT_FONTS,
    inMore: false,
    closeMore,
    onFind,
    onSourceToggle,
    sourceActive,
  };
  const ctxMore: ControlContext = { ...ctxMain, inMore: true };

  // --- roving tabindex: one Tab stop, arrows/Home/End move within the bar ----------------------
  const currentCtl = useRef<HTMLElement | null>(null);
  const allControls = () =>
    Array.from(barRef.current?.querySelectorAll<HTMLElement>('[data-rcm-ctl]') ?? []);
  const enabledControls = () => allControls().filter((el) => !(el as HTMLButtonElement).disabled);
  useLayoutEffect(() => {
    const list = enabledControls();
    const active =
      currentCtl.current && list.includes(currentCtl.current) ? currentCtl.current : list[0];
    for (const el of allControls()) el.tabIndex = el === active ? 0 : -1;
  });
  const onFocus = (event: FocusEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (!target.hasAttribute('data-rcm-ctl')) return;
    currentCtl.current = target;
    for (const el of allControls()) el.tabIndex = el === target ? 0 : -1;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (!target.hasAttribute('data-rcm-ctl')) return;
    const list = enabledControls();
    const i = list.indexOf(target);
    if (i < 0) return;
    let next: number | undefined;
    if (event.key === 'ArrowRight') next = (i + 1) % list.length;
    else if (event.key === 'ArrowLeft') next = (i - 1 + list.length) % list.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = list.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    list[next]?.focus();
  };

  const renderEntry = (entry: ResolvedEntry, index: number, ctx: ControlContext) => {
    if (entry.type === 'sep') {
      return (
        <span
          key={`sep-${index}`}
          className="rcm-tb-sep"
          role="separator"
          aria-orientation="vertical"
          data-rcm-entry={index}
        />
      );
    }
    const itemKey = entry.type === 'builtin' ? entry.key : `custom:${entry.item.key}`;
    const state = states[itemKey] ?? EMPTY_STATE;
    return (
      <div key={`${itemKey}-${index}`} className="rcm-tb-entry" data-rcm-entry={index}>
        {entry.type === 'builtin' ? (
          <BuiltinControl ctx={ctx} itemKey={entry.key} state={state} />
        ) : (
          <CustomControl ctx={ctx} item={entry.item} state={state} />
        )}
      </div>
    );
  };

  return (
    <div
      ref={barRef}
      className={wrap ? 'rcm-tb rcm-tb--wrap' : 'rcm-tb'}
      role="toolbar"
      aria-label={labels.toolbar}
      aria-orientation="horizontal"
      data-testid="rcm-toolbar"
      onFocus={onFocus}
      onKeyDown={onKeyDown}
    >
      {config.start != null && <div className="rcm-tb-slot rcm-tb-slot--start">{config.start}</div>}
      {shown.map(({ entry, index }) => renderEntry(entry, index, ctxMain))}
      {hidden.length > 0 && (
        <MoreMenu ctx={ctxMain} open={moreOpen} setOpen={setMoreOpen}>
          {hidden.map(({ entry, index }) => renderEntry(entry, index, ctxMore))}
        </MoreMenu>
      )}
      {config.end != null && <div className="rcm-tb-slot rcm-tb-slot--end">{config.end}</div>}
    </div>
  );
}

function MoreMenu({
  ctx,
  open,
  setOpen,
  children,
}: {
  ctx: ControlContext;
  open: boolean;
  setOpen: (open: boolean) => void;
  children: ReactNode;
}) {
  const popup = usePopup(ctx.editor, open, setOpen, undefined, 'button');
  const panelId = useId();
  const label = ctx.labels.more;
  return (
    <div
      className="rcm-tb-entry rcm-tb-more"
      data-rcm-entry="more"
      data-rcm-more=""
      ref={popup.rootRef}
      onKeyDown={popup.onKeyDown}
      onBlur={popup.onBlur}
    >
      <button
        type="button"
        className="rcm-tb-btn"
        data-testid="rcm-tb-more"
        data-rcm-ctl=""
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen(!open)}
      >
        {MORE_ICON}
      </button>
      {open && (
        <div
          id={panelId}
          ref={popup.panelRef}
          className="rcm-tb-panel rcm-tb-panel--more"
          role="dialog"
          aria-label={label}
        >
          {children}
        </div>
      )}
    </div>
  );
}
