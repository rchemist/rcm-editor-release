import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { hasCommands } from '../toolbar/items';
import { ICONS } from '../toolbar/icons';
import { usePopup } from '../toolbar/popup';
import { selectedImage } from '../../extensions/image';
import type { ImageAlign } from '../../extensions/image';
import type { RcmEditorLabels } from '../labels';
import { ImageHandles } from './ImageHandles';
import type { ImagePreview } from './ImageHandles';

interface BarTarget {
  pos: number;
  inline: boolean;
  inFigure: boolean;
  align: string | null;
  alt: string;
  canCaption: boolean;
}

function selectTarget({ editor }: { editor: Editor }): BarTarget | null {
  const found = selectedImage(editor.state);
  if (!found) return null;
  const node = editor.state.doc.nodeAt(found.pos);
  if (!node) return null;
  const align = node.attrs.align;
  const alt = node.attrs.alt;
  return {
    pos: found.pos,
    inline: found.inline,
    inFigure: found.inFigure,
    align: typeof align === 'string' ? align : null,
    alt: typeof alt === 'string' ? alt : '',
    canCaption: !found.inline && hasCommands(editor, ['toggleImageCaption']),
  };
}

function imageElement(editor: Editor, pos: number): HTMLImageElement | null {
  try {
    const dom = editor.view.nodeDOM(pos);
    if (dom instanceof HTMLImageElement) return dom;
    if (dom instanceof HTMLElement) return dom.querySelector('img');
  } catch {
    // Stale position after a document change.
  }
  return null;
}

function icon(d: string): ReactNode {
  return (
    <svg
      className="rcm-ib-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

/** Picture flowing with text lines (inline alignment) and a captioned picture. */
const INLINE_ICON = icon('M4 5h10v9H4zM4 19h16M4 15.5h5M17 8h3M17 11.5h3');
const CAPTION_ICON = icon('M4 4h16v11H4zM4 19h16M7 21.5h10');
const ALT_ICON = icon('M4 5h7l9 9-7 7-9-9zM8.5 9.5h.01');

interface BarButtonProps {
  testId: string;
  label: string;
  pressed?: boolean;
  expanded?: boolean;
  controlsId?: string;
  onActivate: () => void;
  children: ReactNode;
}

function BarButton({
  testId,
  label,
  pressed,
  expanded,
  controlsId,
  onActivate,
  children,
}: BarButtonProps) {
  return (
    <button
      type="button"
      className="rcm-ib-btn"
      data-testid={testId}
      data-rcm-ibctl=""
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-controls={controlsId}
      aria-haspopup={expanded !== undefined ? 'dialog' : undefined}
      tabIndex={-1}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onActivate}
    >
      {children}
    </button>
  );
}

export interface ImageToolbarProps {
  editor: Editor;
  labels: RcmEditorLabels;
}

/**
 * Floating image bar: alignment, caption toggle and alt-text popover over the
 * selected image/inlineImage, plus the four resize handles. The wrapper overlays the
 * image's screen rect and never changes the document itself; commands do.
 */
export function ImageToolbar({ editor, labels }: ImageToolbarProps) {
  const target = useEditorState({ editor, selector: selectTarget });
  const [altOpen, setAltOpen] = useState(false);
  const [draft, setDraft] = useState('');
  // The value only re-renders the overlay so it follows the live image rect mid-drag.
  const [, setPreview] = useState<ImagePreview | null>(null);
  const [, setTick] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const popup = usePopup(editor, altOpen, setAltOpen, undefined, 'input');

  const posKey = target?.pos ?? -1;

  // The overlay tracks the image through scrolling/resizing and selection moves.
  useEffect(() => {
    if (posKey < 0) return undefined;
    const reposition = () => setTick((c) => c + 1);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [editor, posKey]);

  // A moved selection takes its bar (and any open popover/preview) with it.
  useEffect(() => {
    setAltOpen(false);
    setPreview(null);
  }, [posKey]);

  // --- roving tabindex: one Tab stop, arrows/Home/End move within the bar ---------------
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const list = Array.from(bar.querySelectorAll<HTMLElement>('[data-rcm-ibctl]'));
    for (const [i, el] of list.entries()) el.tabIndex = i === 0 ? 0 : -1;
  });
  const onBarFocus = (event: FocusEvent<HTMLElement>) => {
    const current = event.target as HTMLElement;
    if (!current.hasAttribute('data-rcm-ibctl')) return;
    for (const el of barRef.current?.querySelectorAll<HTMLElement>('[data-rcm-ibctl]') ?? [])
      el.tabIndex = el === current ? 0 : -1;
  };
  const onBarKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      // An open alt popover handles Esc itself (and stops propagation).
      event.preventDefault();
      editor.commands.focus();
      return;
    }
    const current = event.target as HTMLElement;
    if (current.tagName === 'INPUT' || current.tagName === 'TEXTAREA') return;
    if (!current.hasAttribute('data-rcm-ibctl')) return;
    const list = Array.from(
      barRef.current?.querySelectorAll<HTMLElement>('[data-rcm-ibctl]') ?? [],
    );
    const i = list.indexOf(current);
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

  if (!target) return null;
  const img = imageElement(editor, target.pos);
  if (!img) return null;
  const rect = img.getBoundingClientRect();

  const openAlt = () => {
    setDraft(target.alt);
    setAltOpen(true);
  };
  const applyAlt = (restoreFocus: boolean) => {
    editor.chain().focus().setImageAlt(draft).run();
    setAltOpen(false);
    if (restoreFocus) editor.commands.focus();
  };

  const aligns: { value: ImageAlign; testId: string; label: string; icon: ReactNode }[] =
    target.inline
      ? [
          {
            value: 'left',
            testId: 'rcm-ib-align-left',
            label: labels.ibAlignLeft,
            icon: ICONS.alignLeft,
          },
          {
            value: 'right',
            testId: 'rcm-ib-align-right',
            label: labels.ibAlignRight,
            icon: ICONS.alignRight,
          },
          {
            value: 'inline',
            testId: 'rcm-ib-align-inline',
            label: labels.ibAlignInline,
            icon: INLINE_ICON,
          },
        ]
      : [
          {
            value: 'left',
            testId: 'rcm-ib-align-left',
            label: labels.ibAlignLeft,
            icon: ICONS.alignLeft,
          },
          {
            value: 'center',
            testId: 'rcm-ib-align-center',
            label: labels.ibAlignCenter,
            icon: ICONS.alignCenter,
          },
          {
            value: 'right',
            testId: 'rcm-ib-align-right',
            label: labels.ibAlignRight,
            icon: ICONS.alignRight,
          },
          {
            value: 'inline',
            testId: 'rcm-ib-align-inline',
            label: labels.ibAlignInline,
            icon: INLINE_ICON,
          },
        ];

  return (
    <div
      className="rcm-ib-wrap"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      <div
        ref={barRef}
        className={`rcm-ib${rect.top < 160 ? ' rcm-ib--below' : ''}`}
        role="toolbar"
        aria-label={labels.imageBar}
        data-testid="rcm-image-bar"
        onFocus={onBarFocus}
        onKeyDown={onBarKeyDown}
        onBlur={popup.onBlur}
      >
        {aligns.map((a) => (
          <BarButton
            key={a.value}
            testId={a.testId}
            label={a.label}
            pressed={target.align === a.value}
            onActivate={() => void editor.chain().focus().setImageAlign(a.value).run()}
          >
            {a.icon}
          </BarButton>
        ))}
        {target.canCaption && (
          <BarButton
            testId="rcm-ib-caption"
            label={labels.ibCaption}
            pressed={target.inFigure}
            onActivate={() => void editor.chain().focus().toggleImageCaption().run()}
          >
            {CAPTION_ICON}
          </BarButton>
        )}
        <div className="rcm-ib-altwrap" ref={popup.rootRef} onKeyDown={popup.onKeyDown}>
          <BarButton
            testId="rcm-ib-alt"
            label={labels.ibAlt}
            expanded={altOpen}
            controlsId={altOpen ? panelId : undefined}
            onActivate={openAlt}
          >
            {ALT_ICON}
          </BarButton>
          {altOpen && (
            <div
              id={panelId}
              ref={popup.panelRef}
              className="rcm-ib-panel"
              role="dialog"
              aria-label={labels.ibAlt}
            >
              <form
                className="rcm-ib-altform"
                onSubmit={(event) => {
                  event.preventDefault();
                  applyAlt(true);
                }}
              >
                <input
                  type="text"
                  className="rcm-ib-input"
                  data-testid="rcm-ibo-alt-input"
                  aria-label={labels.ibAlt}
                  title={labels.ibAlt}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <button type="submit" className="rcm-ib-textbtn" data-testid="rcm-ibo-alt-apply">
                  {labels.ibAltApply}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
      <ImageHandles editor={editor} labels={labels} pos={target.pos} onPreview={setPreview} />
    </div>
  );
}
