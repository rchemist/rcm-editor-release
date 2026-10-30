import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import type { RcmEditorLabels } from '../labels';

export type RcmToolbarPreset = 'simple' | 'full';

/** Built-in toolbar items. `find` and `source` are only in `full`. */
export type RcmToolbarItemKey =
  | 'undo'
  | 'redo'
  | 'heading'
  | 'fontFamily'
  | 'fontSize'
  | 'lineHeight'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'code'
  | 'superscript'
  | 'subscript'
  | 'color'
  | 'highlight'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'alignJustify'
  | 'indent'
  | 'outdent'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'blockquote'
  | 'codeBlock'
  | 'horizontalRule'
  | 'table'
  | 'image'
  | 'file'
  | 'youtube'
  | 'link'
  | 'clearFormat'
  | 'find'
  | 'source';

/** A consumer toolbar item (`data-testid="rcm-tb-custom-<key>"`). */
export interface RcmToolbarCustomItem {
  key: string;
  /** `aria-label` and `title` of the generated button. */
  label: string;
  icon?: ReactNode;
  run?: (editor: Editor) => void;
  /** When given the button is a toggle (`aria-pressed`). */
  isActive?: (editor: Editor) => boolean;
  isDisabled?: (editor: Editor) => boolean;
  /** React only: replaces the generated button. */
  render?: (context: { editor: Editor; labels: RcmEditorLabels }) => ReactNode;
}

/** A built-in key, `'|'` (separator) or a custom item. */
export type RcmToolbarEntry = RcmToolbarItemKey | '|' | RcmToolbarCustomItem;

export interface RcmToolbarConfig {
  /** Starting item list (default `'full'`); ignored when `items` is given. */
  preset?: RcmToolbarPreset;
  /** Item list used as-is. */
  items?: readonly RcmToolbarEntry[];
  /** Keys (built-in or custom) to remove; separators are tidied afterwards. */
  hide?: readonly string[];
  /**
   * Items that do not fit one line: `'menu'` (default) moves them into the "more" menu,
   * `'wrap'` wraps the bar onto further lines so every item stays visible.
   */
  overflow?: 'menu' | 'wrap';
  /** Slot before the items (React only). */
  start?: ReactNode;
  /** Slot after the items (React only). */
  end?: ReactNode;
}
