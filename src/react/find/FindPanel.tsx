import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { FindAndReplacePluginKey } from '@tiptap/extension-find-and-replace';
import type { RcmEditorLabels } from '../labels';

function icon(d: string): ReactNode {
  return (
    <svg
      className="rcm-find-icon"
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

const PREV_ICON = icon('M6 14l6-6 6 6');
const NEXT_ICON = icon('M6 10l6 6 6-6');
const CLOSE_ICON = icon('M6 6l12 12M18 6L6 18');

interface PanelButtonProps {
  testId: string;
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function PanelButton({ testId, label, pressed, disabled, onClick, children }: PanelButtonProps) {
  return (
    <button
      type="button"
      className="rcm-find-btn"
      data-testid={testId}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

interface TextButtonProps {
  testId: string;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}

function TextButton({ testId, label, disabled, onClick }: TextButtonProps) {
  return (
    <button
      type="button"
      className="rcm-find-textbtn"
      data-testid={testId}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export interface FindPanelProps {
  editor: Editor;
  labels: RcmEditorLabels;
  /** Read-only editors may search, but the replace row is not rendered. */
  readonly?: boolean;
  /** Clears the search and returns the focus to the editing area. */
  onClose: () => void;
}

/**
 * Find & replace panel, opened by the toolbar `find` item or Mod-F. It drives the tiptap
 * `FindAndReplace` commands; the highlights are decorations, so the document, `getJSON()`/
 * `getHTML()` and `onChange` never contain them.
 */
export function FindPanel({ editor, labels, readonly = false, onClose }: FindPanelProps) {
  // The plugin state is the truth; the inputs mirror it so reopening keeps the last terms.
  const [term, setTerm] = useState(
    () => FindAndReplacePluginKey.getState(editor.state)?.searchTerm ?? '',
  );
  const [replaceTerm, setReplaceTerm] = useState(
    () => FindAndReplacePluginKey.getState(editor.state)?.replaceTerm ?? '',
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // Opening the panel focuses the find input and selects the existing term.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const { total, current, caseSensitive } = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const s = e.storage.findAndReplace;
      return {
        total: s.results.length,
        current: s.currentIndex === null ? 0 : s.currentIndex + 1,
        caseSensitive: s.caseSensitive,
      };
    },
  });

  const onPanelKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  // Enter jumps to the next result, Shift+Enter to the previous one.
  const onFindKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || total === 0) return;
    event.preventDefault();
    if (event.shiftKey) editor.commands.goToPreviousResult();
    else editor.commands.goToNextResult();
  };

  const countText = labels.findCount
    .replace('{current}', String(current))
    .replace('{total}', String(total));

  return (
    <div
      className="rcm-find"
      role="search"
      aria-label={labels.find}
      data-testid="rcm-find-panel"
      onKeyDown={onPanelKeyDown}
    >
      <div className="rcm-find-row">
        <input
          ref={inputRef}
          type="text"
          className="rcm-find-input"
          data-testid="rcm-find-input"
          aria-label={labels.findInput}
          title={labels.findInput}
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            editor.commands.setSearchTerm(event.target.value);
          }}
          onKeyDown={onFindKeyDown}
        />
        <PanelButton
          testId="rcm-find-case"
          label={labels.findCase}
          pressed={caseSensitive}
          onClick={() => editor.commands.setCaseSensitive(!caseSensitive)}
        >
          <span className="rcm-find-glyph" aria-hidden="true">
            Aa
          </span>
        </PanelButton>
        <PanelButton
          testId="rcm-find-prev"
          label={labels.findPrev}
          disabled={total === 0}
          onClick={() => editor.commands.goToPreviousResult()}
        >
          {PREV_ICON}
        </PanelButton>
        <PanelButton
          testId="rcm-find-next"
          label={labels.findNext}
          disabled={total === 0}
          onClick={() => editor.commands.goToNextResult()}
        >
          {NEXT_ICON}
        </PanelButton>
        <span
          className="rcm-find-count"
          data-testid="rcm-find-count"
          data-current={current}
          data-total={total}
          aria-live="polite"
        >
          {countText}
        </span>
        <PanelButton testId="rcm-find-close" label={labels.findClose} onClick={onClose}>
          {CLOSE_ICON}
        </PanelButton>
      </div>
      {!readonly && (
        <div className="rcm-find-row">
          <input
            type="text"
            className="rcm-find-input"
            data-testid="rcm-replace-input"
            aria-label={labels.findReplaceInput}
            title={labels.findReplaceInput}
            value={replaceTerm}
            onChange={(event) => {
              setReplaceTerm(event.target.value);
              editor.commands.setReplaceTerm(event.target.value);
            }}
          />
          <TextButton
            testId="rcm-find-replace"
            label={labels.findReplace}
            disabled={total === 0}
            onClick={() => editor.commands.replace()}
          />
          <TextButton
            testId="rcm-find-replace-all"
            label={labels.findReplaceAll}
            disabled={total === 0}
            onClick={() => editor.commands.replaceAll()}
          />
        </div>
      )}
    </div>
  );
}
