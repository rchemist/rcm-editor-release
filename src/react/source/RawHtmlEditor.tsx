import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { RcmEditorLabels } from '../labels';
import { CodeMirrorHost } from './CodeMirrorHost';

export interface RawHtmlEditorProps {
  labels: RcmEditorLabels;
  /** Current fragment source (the popover starts from the node's verbatim `html`). */
  text: string;
  /** Anchor rect of the raw node's preview (viewport coordinates). */
  left: number;
  top: number;
  onTextChange: (text: string) => void;
  /** Re-runs the preservation for the fragment (one transaction). */
  onApply: () => void;
  /** Parses the fragment into the schema accepting the reported loss (one transaction). */
  onConvert: () => void;
  onClose: () => void;
}

/**
 * Fragment source editor popover of a `rawHtml` node, opened by double-click or Enter
 * on the selected node. Same lazy CodeMirror as the whole-document source mode; the actions
 * are the only two ways the editor unwraps raw content.
 */
export function RawHtmlEditor({
  labels,
  text,
  left,
  top,
  onTextChange,
  onApply,
  onConvert,
  onClose,
}: RawHtmlEditorProps) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const rootRef = useRef<HTMLDivElement>(null);

  // Outside pointer closes the popover (the fragment stays untouched).
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(event.target as Node)) closeRef.current();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closeRef.current();
  };

  return (
    <div
      ref={rootRef}
      className="rcm-raw-pop"
      role="dialog"
      aria-label={labels.rawEditor}
      data-testid="rcm-raw-editor"
      style={{ left, top }}
      onKeyDown={onKeyDown}
    >
      <div className="rcm-raw-pop-body">
        <CodeMirrorHost
          className="rcm-raw-pop-editor"
          testId="rcm-raw-editor-source"
          doc={text}
          ariaLabel={labels.rawEditor}
          focus
          onTextChange={onTextChange}
        />
      </div>
      <div className="rcm-raw-pop-actions">
        <button
          type="button"
          className="rcm-raw-textbtn"
          data-testid="rcm-raw-apply"
          onClick={onApply}
        >
          {labels.rawApply}
        </button>
        <button
          type="button"
          className="rcm-raw-textbtn"
          data-testid="rcm-raw-convert"
          onClick={onConvert}
        >
          {labels.rawConvert}
        </button>
        <button
          type="button"
          className="rcm-raw-textbtn"
          data-testid="rcm-raw-cancel"
          onClick={() => onClose()}
        >
          {labels.rawCancel}
        </button>
      </div>
    </div>
  );
}
