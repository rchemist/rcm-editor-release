import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Editor } from '@tiptap/core';
import type { RcmEditorLabels } from '../labels';

export type ImageCorner = 'nw' | 'ne' | 'sw' | 'se';

const CORNERS: readonly ImageCorner[] = ['nw', 'ne', 'sw', 'se'];

/** Contract minimum: a resized side is never shorter than 16px. */
const MIN_SIZE = 16;

export interface ImagePreview {
  width: number;
  height: number;
  corner: ImageCorner;
}

interface ImageHandlesProps {
  editor: Editor;
  labels: RcmEditorLabels;
  /** Document position of the selected image node. */
  pos: number;
  /** Live preview size for the overlay (the document is untouched until pointer up). */
  onPreview: (preview: ImagePreview | null) => void;
}

function imageElement(editor: Editor, pos: number): HTMLImageElement | null {
  try {
    const dom = editor.view.nodeDOM(pos);
    if (dom instanceof HTMLImageElement) return dom;
    if (dom instanceof HTMLElement) return dom.querySelector('img');
  } catch {
    // Stale position after a document change: no preview, no commit.
  }
  return null;
}

interface Drag {
  startX: number;
  ratio: number;
  img: HTMLImageElement;
  /** Rendered width at drag start; every move recomputes from here (no accumulation). */
  startWidth: number;
  width: number;
  height: number;
  moved: boolean;
}

/**
 * The four contract resize handles (`rcm-image-handle`, one per `data-corner`). Dragging
 * locks the starting aspect ratio and clamps to [16px, editor content width]; the image
 * element is styled directly during the drag (no document change) and a single transaction
 * writes integer `width`/`height` on pointer up (one undo step).
 */
export function ImageHandles({ editor, labels, pos, onPreview }: ImageHandlesProps) {
  const start =
    (corner: ImageCorner) =>
    (event: ReactPointerEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      const img = imageElement(editor, pos);
      if (!img || editor.isDestroyed) return;
      const box = img.getBoundingClientRect();
      if (!(box.width > 0) || !(box.height > 0)) return;
      const drag: Drag = {
        startX: event.clientX,
        ratio: box.width / box.height,
        img,
        startWidth: box.width,
        width: box.width,
        height: box.height,
        moved: false,
      };

      const move = (ev: PointerEvent): void => {
        drag.moved = true;
        const grow =
          corner === 'ne' || corner === 'se' ? ev.clientX - drag.startX : drag.startX - ev.clientX;
        const limit = editor.view.dom.clientWidth;
        const maxWidth = limit > 0 ? limit : Number.POSITIVE_INFINITY;
        // Absolute from the drag start: every move recomputes from `startWidth`.
        let width = Math.min(Math.max(drag.startWidth + grow, MIN_SIZE), maxWidth);
        let height = width / drag.ratio;
        if (height < MIN_SIZE) {
          height = MIN_SIZE;
          width = Math.min(height * drag.ratio, maxWidth);
        }
        drag.width = width;
        drag.height = height;
        drag.img.style.width = `${width}px`;
        drag.img.style.height = `${height}px`;
        onPreview({ width, height, corner });
      };

      const stop = (): void => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
        window.removeEventListener('pointercancel', stop);
        drag.img.style.width = '';
        drag.img.style.height = '';
        onPreview(null);
        // A plain click (no move) never touches the document.
        if (!drag.moved || editor.isDestroyed) return;
        const node = editor.state.doc.nodeAt(pos);
        if (!node || (node.type.name !== 'image' && node.type.name !== 'inlineImage')) return;
        const width = Math.round(drag.width);
        const height = Math.round(drag.height);
        if (node.attrs.width === width && node.attrs.height === height) return;
        editor
          .chain()
          .setNodeSelection(pos)
          .updateAttributes(node.type.name, { width, height })
          .run();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
    };

  return (
    <>
      {CORNERS.map((corner) => (
        // Pointer-drag only: unreachable by keyboard or AT, so the handles are hidden from
        // the a11y tree (an aria-label on a plain div is prohibited and never announced);
        // `title` keeps the mouse tooltip and the injectable label.
        <div
          key={corner}
          className="rcm-ib-handle"
          data-testid="rcm-image-handle"
          data-corner={corner}
          aria-hidden="true"
          title={labels.ibResizeHandle}
          onPointerDown={start(corner)}
        />
      ))}
    </>
  );
}
