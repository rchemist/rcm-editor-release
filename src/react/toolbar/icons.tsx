import type { ReactNode } from 'react';
import type { RcmToolbarItemKey } from './types';

function svg(d: string, extra?: ReactNode): ReactNode {
  return (
    <svg
      className="rcm-tb-icon"
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
      {extra}
    </svg>
  );
}

/**
 * Glyph icon: the character is CSS `content` on `::before` (see editor.css), never DOM text —
 * visible button text must not compete with the injected `aria-label` for the accessible
 * name (axe `label-content-name-mismatch`).
 */
function glyph(variant: string): ReactNode {
  return <span className={`rcm-tb-glyph rcm-tb-glyph--${variant}`} aria-hidden="true" />;
}

export const MORE_ICON = svg('M5 12h.01M12 12h.01M19 12h.01');

/** Icons of the built-in items (glyphs and paths carry no language). */
export const ICONS: Partial<Record<RcmToolbarItemKey, ReactNode>> = {
  undo: svg('M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3'),
  redo: svg('M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3'),
  bold: glyph('bold'),
  italic: glyph('italic'),
  underline: glyph('underline'),
  strike: glyph('strike'),
  code: svg('M8.5 7l-4.5 5 4.5 5M15.5 7l4.5 5-4.5 5M13.5 4.5l-3 15'),
  superscript: glyph('superscript'),
  subscript: glyph('subscript'),
  color: glyph('color'),
  highlight: glyph('highlight'),
  alignLeft: svg('M4 6h16M4 10h10M4 14h16M4 18h10'),
  alignCenter: svg('M4 6h16M7 10h10M4 14h16M7 18h10'),
  alignRight: svg('M4 6h16M10 10h10M4 14h16M10 18h10'),
  alignJustify: svg('M4 6h16M4 10h16M4 14h16M4 18h16'),
  indent: svg('M4 6h16M11 10h9M11 14h9M4 18h16M4 9l3 3-3 3'),
  outdent: svg('M4 6h16M11 10h9M11 14h9M4 18h16M7 9l-3 3 3 3'),
  bulletList: svg('M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01'),
  orderedList: svg(
    'M10 6h10M10 12h10M10 18h10M4 5.5l1-.8V9M3.5 13.5c0-1.2 2.5-1.2 2.5 0s-2.5 1.8-2.5 3h2.5',
  ),
  taskList: svg(
    'M9 6h11M9 12h11M9 18h11M3.5 5.6l1.3 1.3 2.5-2.7M3.5 11.6l1.3 1.3 2.5-2.7M3.5 17.6l1.3 1.3 2.5-2.7',
  ),
  blockquote: svg('M6 17h3l2-4V7H5v6h3M14 17h3l2-4V7h-6v6h3'),
  codeBlock: svg('M3.5 4.5h17v15h-17zM8.5 9.5l-2 2.5 2 2.5M15.5 9.5l2 2.5-2 2.5'),
  horizontalRule: svg('M3 12h18'),
  table: svg('M4 5h16v14H4zM4 11h16M4 15h16M10 5v14M15 5v14'),
  image: svg('M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9.5h.01'),
  file: svg(
    'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48',
  ),
  youtube: svg(
    'M2.5 8c0-3 2.2-4.8 4.9-4.8h9.2c2.7 0 4.9 1.8 4.9 4.8v8c0 3-2.2 4.8-4.9 4.8H7.4C4.7 20.8 2.5 19 2.5 16zM10.2 8.9v6.2l5.4-3.1z',
  ),
  link: svg(
    'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  ),
  clearFormat: svg('M5 5h10M10 5L7 19M14 14l6 6M20 14l-6 6'),
  lineHeight: svg('M9 6h11M9 12h11M9 18h11M4 8V4M2.5 5.5L4 4l1.5 1.5M4 16v4M2.5 18.5L4 20l1.5-1.5'),
  find: svg('M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l5 5'),
  source: svg('M8 5L3 12l5 7M16 5l5 7-5 7'),
};
