import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import type { RcmEditorLabels } from '../labels';
import type { RcmFontOption } from '../RcmEditor';
import { usePopup } from './popup';
import { ICONS } from './icons';
import {
  BUILTIN,
  COLOR_PALETTE,
  FONT_SIZES_PT,
  LINE_HEIGHTS,
  effectiveFontSize,
  toHex6,
} from './items';
import type { ItemState } from './items';
import type { RcmToolbarCustomItem, RcmToolbarItemKey } from './types';

export interface ControlContext {
  editor: Editor;
  labels: RcmEditorLabels;
  fonts: readonly RcmFontOption[];
  /** Rendered inside the overflow panel (no roving tabindex there). */
  inMore: boolean;
  closeMore: () => void;
  /** Opens the find & replace panel; undefined only without the feature. */
  onFind?: () => void;
  /** Toggles the HTML source mode; undefined only when `sourceMode` is false. */
  onSourceToggle?: () => void;
  /** The HTML source mode is active (the editing area is replaced by the source editor). */
  sourceActive?: boolean;
}

/** Marks a control as a stop of the toolbar's roving tabindex. */
const ctlAttr = (inMore: boolean) => (inMore ? {} : { 'data-rcm-ctl': '' });

const keepSelection = (event: { preventDefault: () => void }) => event.preventDefault();

interface ButtonProps {
  ctx: ControlContext;
  testId: string;
  label: string;
  pressed?: boolean;
  active?: boolean;
  disabled?: boolean;
  onActivate: () => void;
  children: ReactNode;
}

function ToolbarButton({
  ctx,
  testId,
  label,
  pressed,
  active,
  disabled,
  onActivate,
  children,
}: ButtonProps) {
  return (
    <button
      type="button"
      className="rcm-tb-btn"
      data-testid={testId}
      data-active={active ? '' : undefined}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onMouseDown={keepSelection}
      onClick={onActivate}
      {...ctlAttr(ctx.inMore)}
    >
      {children}
    </button>
  );
}

// --- popup trigger + panel ------------------------------------------------------------------

interface PopupProps {
  ctx: ControlContext;
  testId: string;
  label: string;
  haspopup: 'menu' | 'dialog';
  panelRole: 'menu' | 'dialog';
  focusSelector: string;
  active?: boolean;
  triggerClass?: string;
  triggerContent: ReactNode;
  /** Renders the panel content; `close(restore)` closes it. */
  children: (api: { close: (restoreFocus: boolean) => void }) => ReactNode;
  openOnArrow?: boolean;
}

function Popup({
  ctx,
  testId,
  label,
  haspopup,
  panelRole,
  focusSelector,
  active,
  triggerClass,
  triggerContent,
  children,
  openOnArrow,
}: PopupProps) {
  const [open, setOpen] = useState(false);
  const popup = usePopup(ctx.editor, open, setOpen, ctx.closeMore, focusSelector);
  const panelId = useId();
  const close = (restore: boolean) => {
    setOpen(false);
    if (restore) ctx.editor.commands.focus();
  };
  return (
    <div
      className="rcm-tb-popup"
      ref={popup.rootRef}
      onKeyDown={popup.onKeyDown}
      onBlur={popup.onBlur}
    >
      <button
        type="button"
        className={`rcm-tb-btn ${triggerClass ?? ''}`.trim()}
        data-testid={testId}
        data-active={active ? '' : undefined}
        aria-label={label}
        title={label}
        aria-haspopup={haspopup}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onMouseDown={keepSelection}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (openOnArrow && event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        {...ctlAttr(ctx.inMore)}
      >
        {triggerContent}
      </button>
      {open && (
        <div
          id={panelId}
          ref={popup.panelRef}
          className={`rcm-tb-panel rcm-tb-panel--${panelRole}${popup.alignEnd ? ' rcm-tb-panel--end' : ''}`}
          role={panelRole}
          aria-label={label}
        >
          {children({ close })}
        </div>
      )}
    </div>
  );
}

// --- menus (font, size, line spacing) --------------------------------------------------------

interface MenuOption {
  value: string;
  text: string;
  checked: boolean;
  style?: CSSProperties;
}

interface MenuProps {
  ctx: ControlContext;
  itemKey: RcmToolbarItemKey;
  triggerText: ReactNode;
  options: readonly MenuOption[];
  onSelect: (value: string) => void;
  triggerClass?: string;
}

function onMenuKeyDown(event: KeyboardEvent<HTMLElement>): void {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
  );
  if (items.length === 0) return;
  const current = items.indexOf(document.activeElement as HTMLElement);
  let next = current;
  if (event.key === 'ArrowDown') next = (current + 1) % items.length;
  else if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
  else if (event.key === 'Home') next = 0;
  else next = items.length - 1;
  event.preventDefault();
  items[next]?.focus();
}

function Menu({ ctx, itemKey, triggerText, options, onSelect, triggerClass }: MenuProps) {
  const label = ctx.labels[itemKey];
  return (
    <Popup
      ctx={ctx}
      testId={`rcm-tb-${itemKey}`}
      label={label}
      haspopup="menu"
      panelRole="menu"
      focusSelector='[role="menuitemradio"]'
      triggerClass={`rcm-tb-btn--menu ${triggerClass ?? ''}`}
      triggerContent={
        <>
          {/* Plain strings render as CSS `content: attr(data-value)`: visible trigger
              text must not compete with the injected aria-label for the accessible name. */}
          {typeof triggerText === 'string' ? (
            <span className="rcm-tb-menu-text" aria-hidden="true" data-value={triggerText} />
          ) : (
            <span className="rcm-tb-menu-text" aria-hidden="true">
              {triggerText}
            </span>
          )}
          <span className="rcm-tb-caret" aria-hidden="true" />
        </>
      }
      openOnArrow
    >
      {({ close }) => (
        <div className="rcm-tb-menu" onKeyDown={onMenuKeyDown}>
          {options.map((option, i) => (
            <button
              key={`${i}:${option.value}`}
              type="button"
              role="menuitemradio"
              aria-checked={option.checked}
              className="rcm-tb-menuitem"
              data-testid={`rcm-tbo-${itemKey}`}
              data-value={option.value}
              style={option.style}
              tabIndex={-1}
              onMouseDown={keepSelection}
              onClick={() => {
                onSelect(option.value);
                close(true);
              }}
            >
              {option.text}
            </button>
          ))}
        </div>
      )}
    </Popup>
  );
}

function firstFamily(stack: string): string {
  const first = stack.split(',')[0] ?? '';
  return first.trim().replace(/^['"]|['"]$/g, '');
}

function FontFamilyMenu({ ctx, state }: { ctx: ControlContext; state: ItemState }) {
  const { editor, labels, fonts } = ctx;
  const current = state.v.trim();
  const options: MenuOption[] = [
    { value: '', text: labels.fontDefault, checked: current === '' },
    ...fonts.map((font) => ({
      value: font.value,
      text: font.label,
      checked: font.value.trim() === current,
      style: { fontFamily: font.value } as CSSProperties,
    })),
  ];
  const known = options.find((o) => o.checked && o.value !== '');
  return (
    <Menu
      ctx={ctx}
      itemKey="fontFamily"
      triggerClass="rcm-tb-btn--font"
      triggerText={known?.text ?? (current ? firstFamily(current) : labels.fontDefault)}
      options={options}
      onSelect={(value) => {
        if (value === '') editor.chain().focus().unsetFontFamily().run();
        else editor.chain().focus().setFontFamily(value).run();
      }}
    />
  );
}

function FontSizeMenu({ ctx, state }: { ctx: ControlContext; state: ItemState }) {
  // The state selector first runs before the editor is laid out (no rendered size yet), and
  // re-runs only on transactions: read the rendered size once after mount as well.
  const [mounted, setMounted] = useState('');
  useEffect(() => setMounted(effectiveFontSize(ctx.editor)), [ctx.editor]);
  const current = state.v.trim() || mounted;
  const options: MenuOption[] = FONT_SIZES_PT.map((n) => ({
    value: `${n}pt`,
    text: n,
    checked: current === `${n}pt`,
  }));
  return (
    <Menu
      ctx={ctx}
      itemKey="fontSize"
      triggerClass="rcm-tb-btn--size"
      triggerText={current.replace(/pt$/, '') || ctx.labels.fontSize}
      options={options}
      onSelect={(value) => void ctx.editor.chain().focus().setFontSize(value).run()}
    />
  );
}

function LineHeightMenu({ ctx, state }: { ctx: ControlContext; state: ItemState }) {
  const current = state.v.trim();
  const options: MenuOption[] = [
    { value: '', text: ctx.labels.lineHeightDefault, checked: current === '' },
    ...LINE_HEIGHTS.map((h) => ({
      value: h.value,
      text: h.text,
      checked: current === h.value,
    })),
  ];
  return (
    <Menu
      ctx={ctx}
      itemKey="lineHeight"
      triggerClass="rcm-tb-btn--icon-menu"
      triggerText={ICONS.lineHeight}
      options={options}
      onSelect={(value) => {
        const chain = ctx.editor.chain().focus();
        if (value === '') chain.unsetLineHeight().run();
        else chain.setLineHeight(value).run();
      }}
    />
  );
}

/** Paragraph (본문) and heading levels 1–3 (제목 1/2/3), like common legacy editors. */
function HeadingMenu({ ctx, state }: { ctx: ControlContext; state: ItemState }) {
  const { editor, labels } = ctx;
  const current = state.v.trim();
  const options: MenuOption[] = [
    { value: '', text: labels.paragraph, checked: current === '' },
    ...([1, 2, 3] as const).map((level) => ({
      value: String(level),
      text: labels[`heading${level}`],
      checked: current === String(level),
    })),
  ];
  const known = options.find((o) => o.checked && o.value !== '');
  return (
    <Menu
      ctx={ctx}
      itemKey="heading"
      triggerClass="rcm-tb-btn--heading"
      triggerText={known?.text ?? labels.paragraph}
      options={options}
      onSelect={(value) => {
        if (value === '') editor.chain().focus().setParagraph().run();
        else
          editor
            .chain()
            .focus()
            .setHeading({ level: Number(value) as 1 | 2 | 3 })
            .run();
      }}
    />
  );
}

// --- colours -------------------------------------------------------------------------------

function ColorPopover({
  ctx,
  state,
  kind,
}: {
  ctx: ControlContext;
  state: ItemState;
  kind: 'color' | 'highlight';
}) {
  const { editor, labels } = ctx;
  const current = toHex6(state.v) ?? '';
  const apply = (hex: string, focus: boolean) => {
    const chain = focus ? editor.chain().focus() : editor.chain();
    if (kind === 'color') chain.setColor(hex).run();
    else chain.setHighlight({ color: hex }).run();
  };
  const remove = () => {
    const chain = editor.chain().focus();
    if (kind === 'color') chain.unsetColor().run();
    else chain.unsetHighlight().run();
  };
  return (
    <Popup
      ctx={ctx}
      testId={`rcm-tb-${kind}`}
      label={labels[kind]}
      haspopup="dialog"
      panelRole="dialog"
      focusSelector="button"
      active={kind === 'highlight' ? BUILTIN.highlight.isActive?.(editor) : current !== ''}
      triggerContent={
        <span className="rcm-tb-colorcell">
          {ICONS[kind]}
          <span
            className="rcm-tb-colorbar"
            style={{ background: current || 'transparent' }}
            aria-hidden="true"
          />
        </span>
      }
    >
      {({ close }) => (
        <div className="rcm-tb-colors">
          <div className="rcm-tb-swatches">
            {COLOR_PALETTE.map((hex) => (
              <button
                key={hex}
                type="button"
                className="rcm-tb-swatch"
                data-testid={`rcm-tbo-${kind}-swatch`}
                data-value={hex}
                aria-label={hex}
                title={hex}
                aria-pressed={current === hex}
                style={{ background: hex }}
                onMouseDown={keepSelection}
                onClick={() => {
                  apply(hex, true);
                  close(true);
                }}
              />
            ))}
          </div>
          <label className="rcm-tb-field">
            <span>{labels.customColor}</span>
            <input
              type="color"
              data-testid={`rcm-tbo-${kind}-custom`}
              aria-label={labels.customColor}
              title={labels.customColor}
              value={current || '#000000'}
              onChange={(event) => {
                const hex = toHex6(event.target.value);
                if (hex) apply(hex, false);
              }}
            />
          </label>
          <button
            type="button"
            className="rcm-tb-textbtn"
            data-testid={`rcm-tbo-${kind}-remove`}
            onMouseDown={keepSelection}
            onClick={() => {
              remove();
              close(true);
            }}
          >
            {labels.removeColor}
          </button>
        </div>
      )}
    </Popup>
  );
}

// --- link ----------------------------------------------------------------------------------

function LinkForm({
  ctx,
  href,
  close,
}: {
  ctx: ControlContext;
  href: string;
  close: (restoreFocus: boolean) => void;
}) {
  const { editor, labels } = ctx;
  const [value, setValue] = useState(href);
  const remove = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    close(true);
  };
  return (
    <form
      className="rcm-tb-linkform"
      onSubmit={(event) => {
        event.preventDefault();
        const url = value.trim();
        if (url === '') {
          remove();
          return;
        }
        editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
        close(true);
      }}
    >
      <input
        type="text"
        inputMode="url"
        className="rcm-tb-input"
        data-testid="rcm-tbo-link-url"
        aria-label={labels.linkUrl}
        title={labels.linkUrl}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" className="rcm-tb-textbtn" data-testid="rcm-tbo-link-apply">
        {labels.linkApply}
      </button>
      <button
        type="button"
        className="rcm-tb-textbtn"
        data-testid="rcm-tbo-link-remove"
        disabled={!editor.isActive('link')}
        onClick={remove}
      >
        {labels.linkRemove}
      </button>
    </form>
  );
}

function LinkPopover({ ctx, state }: { ctx: ControlContext; state: ItemState }) {
  return (
    <Popup
      ctx={ctx}
      testId="rcm-tb-link"
      label={ctx.labels.link}
      haspopup="dialog"
      panelRole="dialog"
      focusSelector="input"
      active={state.a}
      triggerContent={ICONS.link}
    >
      {({ close }) => <LinkForm ctx={ctx} href={state.v} close={close} />}
    </Popup>
  );
}

// --- youtube -------------------------------------------------------------------------------

function YoutubeForm({
  ctx,
  close,
}: {
  ctx: ControlContext;
  close: (restoreFocus: boolean) => void;
}) {
  const { editor, labels } = ctx;
  const [value, setValue] = useState('');
  return (
    <form
      className="rcm-tb-linkform"
      onSubmit={(event) => {
        event.preventDefault();
        const url = value.trim();
        // Empty input and non-YouTube URLs do nothing (`setYoutubeVideo` refuses them);
        // the popover stays open so the URL can be corrected.
        if (url === '') return;
        const applied = editor.chain().focus().setYoutubeVideo({ src: url }).run();
        if (!applied) return;
        close(true);
      }}
    >
      <input
        type="text"
        inputMode="url"
        className="rcm-tb-input"
        data-testid="rcm-tbo-youtube-url"
        aria-label={labels.youtubeUrl}
        title={labels.youtubeUrl}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" className="rcm-tb-textbtn" data-testid="rcm-tbo-youtube-apply">
        {labels.youtubeApply}
      </button>
    </form>
  );
}

function YoutubePopover({ ctx }: { ctx: ControlContext; state: ItemState }) {
  return (
    <Popup
      ctx={ctx}
      testId="rcm-tb-youtube"
      label={ctx.labels.youtube}
      haspopup="dialog"
      panelRole="dialog"
      focusSelector="input"
      triggerContent={ICONS.youtube}
    >
      {({ close }) => <YoutubeForm ctx={ctx} close={close} />}
    </Popup>
  );
}

// --- image (file chooser → upload pipeline) ------------------------------------------------

function ImageButton({ ctx, state }: { ctx: ControlContext; state: ItemState }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <ToolbarButton
        ctx={ctx}
        testId="rcm-tb-image"
        label={ctx.labels.image}
        active={state.a}
        disabled={state.d}
        onActivate={() => input.current?.click()}
      >
        {ICONS.image}
      </ToolbarButton>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        tabIndex={-1}
        aria-hidden="true"
        data-testid="rcm-tbo-image-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Allow choosing the same file again.
          event.target.value = '';
          if (files.length > 0) ctx.editor.chain().focus().uploadFiles(files).run();
        }}
      />
    </>
  );
}

/** Any file (no `accept` filter): the pipeline uploads it with `uploadFile` and inserts a link. */
function FileButton({ ctx, state }: { ctx: ControlContext; state: ItemState }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <ToolbarButton
        ctx={ctx}
        testId="rcm-tb-file"
        label={ctx.labels.file}
        active={state.a}
        disabled={state.d}
        onActivate={() => input.current?.click()}
      >
        {ICONS.file}
      </ToolbarButton>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        aria-hidden="true"
        data-testid="rcm-tbo-file-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Allow choosing the same file again.
          event.target.value = '';
          if (files.length > 0) ctx.editor.chain().focus().uploadFiles(files).run();
        }}
      />
    </>
  );
}

// --- table grid picker ---------------------------------------------------------------------

export const TABLE_GRID_SIZE = 10;

function TableGrid({
  ctx,
  close,
}: {
  ctx: ControlContext;
  close: (restoreFocus: boolean) => void;
}) {
  const [hot, setHot] = useState({ row: 1, col: 1 });
  const cells = [];
  for (let row = 1; row <= TABLE_GRID_SIZE; row++) {
    for (let col = 1; col <= TABLE_GRID_SIZE; col++) {
      cells.push(
        <button
          key={`${row}-${col}`}
          type="button"
          className="rcm-tb-gridcell"
          data-testid="rcm-tbo-table-cell"
          data-row={row}
          data-col={col}
          data-hot={row <= hot.row && col <= hot.col ? '' : undefined}
          aria-label={`${row} × ${col}`}
          tabIndex={row === hot.row && col === hot.col ? 0 : -1}
          onMouseDown={keepSelection}
          onMouseEnter={() => setHot({ row, col })}
          onFocus={() => setHot({ row, col })}
          onClick={() => {
            ctx.editor
              .chain()
              .focus()
              .insertTable({ rows: row, cols: col, withHeaderRow: false })
              .run();
            close(true);
          }}
        />,
      );
    }
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const delta: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const d = delta[event.key];
    if (!d) return;
    event.preventDefault();
    const row = Math.min(TABLE_GRID_SIZE, Math.max(1, hot.row + d[0]));
    const col = Math.min(TABLE_GRID_SIZE, Math.max(1, hot.col + d[1]));
    setHot({ row, col });
    event.currentTarget
      .querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`)
      ?.focus();
  };
  return (
    <div className="rcm-tb-tablegrid">
      <div
        className="rcm-tb-grid"
        role="group"
        aria-label={ctx.labels.tableGrid}
        onKeyDown={onKeyDown}
        onMouseLeave={() => setHot({ row: 1, col: 1 })}
      >
        {cells}
      </div>
      <div className="rcm-tb-gridsize" aria-live="polite">
        {hot.row} × {hot.col}
      </div>
    </div>
  );
}

function TablePopover({ ctx, state }: { ctx: ControlContext; state: ItemState }) {
  return (
    <Popup
      ctx={ctx}
      testId="rcm-tb-table"
      label={ctx.labels.table}
      haspopup="dialog"
      panelRole="dialog"
      focusSelector="button"
      active={state.a}
      triggerContent={ICONS.table}
    >
      {({ close }) => <TableGrid ctx={ctx} close={close} />}
    </Popup>
  );
}

// --- entries -------------------------------------------------------------------------------

export function BuiltinControl({
  ctx,
  itemKey,
  state,
}: {
  ctx: ControlContext;
  itemKey: RcmToolbarItemKey;
  state: ItemState;
}) {
  switch (itemKey) {
    case 'fontFamily':
      return <FontFamilyMenu ctx={ctx} state={state} />;
    case 'fontSize':
      return <FontSizeMenu ctx={ctx} state={state} />;
    case 'lineHeight':
      return <LineHeightMenu ctx={ctx} state={state} />;
    case 'heading':
      return <HeadingMenu ctx={ctx} state={state} />;
    case 'color':
    case 'highlight':
      return <ColorPopover ctx={ctx} state={state} kind={itemKey} />;
    case 'table':
      return <TablePopover ctx={ctx} state={state} />;
    case 'image':
      return <ImageButton ctx={ctx} state={state} />;
    case 'file':
      return <FileButton ctx={ctx} state={state} />;
    case 'youtube':
      return <YoutubePopover ctx={ctx} state={state} />;
    case 'link':
      return <LinkPopover ctx={ctx} state={state} />;
    case 'find':
      return (
        <ToolbarButton
          ctx={ctx}
          testId="rcm-tb-find"
          label={ctx.labels.find}
          onActivate={() => ctx.onFind?.()}
        >
          {ICONS.find}
        </ToolbarButton>
      );
    case 'source':
      return (
        <ToolbarButton
          ctx={ctx}
          testId="rcm-tb-source"
          label={ctx.labels.source}
          pressed={ctx.sourceActive ?? false}
          disabled={!ctx.onSourceToggle}
          onActivate={() => ctx.onSourceToggle?.()}
        >
          {ICONS.source}
        </ToolbarButton>
      );
    default: {
      const def = BUILTIN[itemKey];
      return (
        <ToolbarButton
          ctx={ctx}
          testId={`rcm-tb-${itemKey}`}
          label={ctx.labels[itemKey]}
          pressed={def.toggle ? state.a : undefined}
          active={state.a}
          disabled={state.d}
          onActivate={() => def.run?.(ctx.editor)}
        >
          {ICONS[itemKey]}
        </ToolbarButton>
      );
    }
  }
}

export function CustomControl({
  ctx,
  item,
  state,
}: {
  ctx: ControlContext;
  item: RcmToolbarCustomItem;
  state: ItemState;
}) {
  if (item.render) return <>{item.render({ editor: ctx.editor, labels: ctx.labels })}</>;
  return (
    <ToolbarButton
      ctx={ctx}
      testId={`rcm-tb-custom-${item.key}`}
      label={item.label}
      pressed={item.isActive ? state.a : undefined}
      active={state.a}
      disabled={state.d}
      onActivate={() => {
        item.run?.(ctx.editor);
        ctx.editor.commands.focus();
      }}
    >
      {item.icon ?? (
        <span className="rcm-tb-glyph" aria-hidden="true">
          {item.label.slice(0, 1)}
        </span>
      )}
    </ToolbarButton>
  );
}
