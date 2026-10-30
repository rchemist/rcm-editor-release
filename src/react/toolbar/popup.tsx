import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, RefObject } from 'react';
import type { Editor } from '@tiptap/core';

export interface PopupApi {
  rootRef: RefObject<HTMLDivElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Panel is anchored at the right edge of its entry (it would leave the viewport otherwise). */
  alignEnd: boolean;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onBlur: (event: FocusEvent<HTMLElement>) => void;
}

/**
 * Shared behaviour of menus, popovers and the overflow panel: closes on outside pointer,
 * focus leaving, and Esc (focus returns to the editing area). `closeParent` also closes an
 * enclosing overflow panel.
 */
export function usePopup(
  editor: Editor,
  open: boolean,
  setOpen: (open: boolean) => void,
  closeParent?: () => void,
  focusSelector?: string,
): PopupApi {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [alignEnd, setAlignEnd] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, setOpen]);

  useLayoutEffect(() => {
    if (!open) {
      setAlignEnd(false);
      return;
    }
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    setAlignEnd(rect.width > 0 && rect.right > window.innerWidth - 4);
  }, [open]);

  useEffect(() => {
    if (!open || !focusSelector) return;
    const panel = panelRef.current;
    const target =
      panel?.querySelector<HTMLElement>(`${focusSelector}[aria-checked='true']`) ??
      panel?.querySelector<HTMLElement>(focusSelector);
    target?.focus();
  }, [open, focusSelector]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Escape' || !open) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      closeParent?.();
      editor.commands.focus();
    },
    [open, setOpen, closeParent, editor],
  );

  const onBlur = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      const next = event.relatedTarget as Node | null;
      if (open && next && !rootRef.current?.contains(next)) setOpen(false);
    },
    [open, setOpen],
  );

  return { rootRef, panelRef, open, setOpen, alignEnd, onKeyDown, onBlur };
}
