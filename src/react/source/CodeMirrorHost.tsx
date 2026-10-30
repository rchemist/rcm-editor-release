import { useEffect, useRef } from 'react';
import type { FocusEvent } from 'react';
import type { EditorView } from '@codemirror/view';
import { loadCodeMirror } from './codemirror';

/** DOM expando tests use to reach the CodeMirror view of a mounted host. */
export interface CodeMirrorHostElement extends HTMLElement {
  __rcmCodeMirror?: EditorView;
}

export interface CodeMirrorHostProps {
  className?: string;
  testId: string;
  /** Initial text; later prop changes are ignored (the editor owns the text from here on). */
  doc: string;
  ariaLabel: string;
  /** Focus the editor once it is created. */
  focus?: boolean;
  onTextChange: (text: string) => void;
  /** Focus left the editor entirely (not just moved inside it): flush pending notifications. */
  onBlurLeave?: () => void;
}

/**
 * Mounts the lazily loaded CodeMirror 6 HTML editor. Both the whole-document source
 * mode and the raw-fragment popover render this host; the initial `doc` is placed verbatim.
 */
export function CodeMirrorHost({
  className,
  testId,
  doc,
  ariaLabel,
  focus = false,
  onTextChange,
  onBlurLeave,
}: CodeMirrorHostProps) {
  const hostRef = useRef<HTMLElement | null>(null);
  const changeRef = useRef(onTextChange);
  changeRef.current = onTextChange;

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;
    void loadCodeMirror().then((api) => {
      const host = hostRef.current;
      if (cancelled || !host) return;
      const handle = api.createSourceEditor({
        parent: host,
        doc,
        ariaLabel,
        onChange: (text) => changeRef.current(text),
      });
      (host as CodeMirrorHostElement).__rcmCodeMirror = handle.view;
      destroy = handle.destroy;
      if (focus) handle.view.focus();
    });
    return () => {
      cancelled = true;
      destroy?.();
    };
    // Mount once: the mounted editor owns the text from here on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onBlur = (event: FocusEvent<HTMLElement>) => {
    if (!onBlurLeave) return;
    const next = event.relatedTarget;
    if (next && event.currentTarget.contains(next as Node)) return;
    onBlurLeave();
  };

  return (
    <div
      ref={(el) => {
        hostRef.current = el;
      }}
      className={`rcm-cm ${className ?? ''}`.trim()}
      data-testid={testId}
      onBlur={onBlur}
    />
  );
}
