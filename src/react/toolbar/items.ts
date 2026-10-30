import type { Editor } from '@tiptap/core';
import type { UploadStorage } from '../../extensions/upload';
import { UNSUPPORTED_MARK } from '../../guard/unsupported';
import type { RcmFontOption } from '../RcmEditor';
import type {
  RcmToolbarConfig,
  RcmToolbarCustomItem,
  RcmToolbarEntry,
  RcmToolbarItemKey,
  RcmToolbarPreset,
} from './types';

export const TOOLBAR_ITEM_KEYS = [
  'undo',
  'redo',
  'heading',
  'fontFamily',
  'fontSize',
  'lineHeight',
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'superscript',
  'subscript',
  'color',
  'highlight',
  'alignLeft',
  'alignCenter',
  'alignRight',
  'alignJustify',
  'indent',
  'outdent',
  'bulletList',
  'orderedList',
  'taskList',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'table',
  'image',
  'file',
  'youtube',
  'link',
  'clearFormat',
  'find',
  'source',
] as const satisfies readonly RcmToolbarItemKey[];

/** Preset item lists (`'|'` is a separator). */
export const TOOLBAR_PRESETS: Readonly<Record<RcmToolbarPreset, readonly RcmToolbarEntry[]>> = {
  simple: [
    'undo',
    'redo',
    '|',
    'heading',
    '|',
    'bold',
    'italic',
    'underline',
    'strike',
    '|',
    'color',
    'highlight',
    '|',
    'alignLeft',
    'alignCenter',
    'alignRight',
    '|',
    'bulletList',
    'orderedList',
    '|',
    'image',
    'file',
    'link',
    'clearFormat',
  ],
  full: [
    'undo',
    'redo',
    '|',
    'heading',
    '|',
    'bold',
    'italic',
    'underline',
    'strike',
    'code',
    'superscript',
    'subscript',
    '|',
    'color',
    'highlight',
    '|',
    'fontFamily',
    'fontSize',
    'lineHeight',
    '|',
    'alignLeft',
    'alignCenter',
    'alignRight',
    'alignJustify',
    '|',
    'indent',
    'outdent',
    '|',
    'bulletList',
    'orderedList',
    'taskList',
    'blockquote',
    'codeBlock',
    'horizontalRule',
    'table',
    '|',
    'image',
    'file',
    'youtube',
    'link',
    'clearFormat',
    'find',
    'source',
  ],
};

/** Built-in font list (all OFL). The "default" entry is added by the menu itself. */
export const DEFAULT_FONTS: readonly RcmFontOption[] = [
  { label: 'Pretendard', value: "Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif" },
  { label: 'Noto Sans KR', value: "'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif" },
  { label: 'Noto Serif KR', value: "'Noto Serif KR', serif" },
  { label: '나눔고딕', value: "NanumGothic, 'Nanum Gothic', 'Malgun Gothic', sans-serif" },
  { label: '나눔명조', value: "NanumMyeongjo, 'Nanum Myeongjo', serif" },
];

export const FONT_SIZES_PT: readonly string[] = [
  '8',
  '9',
  '10',
  '10.5',
  '11',
  '12',
  '14',
  '16',
  '18',
  '20',
  '24',
  '28',
  '32',
  '36',
];

/** Display text and stored value (`setLineHeight`) of the line spacing menu. */
export const LINE_HEIGHTS: readonly { text: string; value: string }[] = [
  { text: '1.0', value: '1' },
  { text: '1.15', value: '1.15' },
  { text: '1.5', value: '1.5' },
  { text: '1.6', value: '1.6' },
  { text: '1.8', value: '1.8' },
  { text: '2.0', value: '2' },
];

export const COLOR_PALETTE: readonly string[] = [
  '#000000',
  '#434343',
  '#666666',
  '#999999',
  '#cccccc',
  '#ffffff',
  '#e53935',
  '#fb8c00',
  '#fdd835',
  '#43a047',
  '#00acc1',
  '#1e88e5',
  '#5e35b1',
  '#d81b60',
  '#8d6e63',
  '#ffcdd2',
  '#ffe0b2',
  '#fff9c4',
  '#c8e6c9',
  '#bbdefb',
];

/** `#rgb` / `#rrggbb` in any case → lowercase `#rrggbb`; anything else → null. */
export function toHex6(value: string): string | null {
  const raw = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(raw);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : null;
}

// --- built-in item definitions ------------------------------------------------------------

export interface BuiltinDef {
  kind: 'button' | 'menu' | 'popover';
  /** Editor commands that must exist, else the item is omitted. */
  commands: readonly string[];
  /** Extra runtime requirement, else the item is omitted (e.g. a configured file uploader). */
  available?: (editor: Editor) => boolean;
  /** Renders `aria-pressed`. */
  toggle?: boolean;
  isActive?: (editor: Editor) => boolean;
  isDisabled?: (editor: Editor) => boolean;
  run?: (editor: Editor) => void;
  /** Current value of menu/popover items (font, size, colour…). */
  value?: (editor: Editor) => string;
}

type Align = 'left' | 'center' | 'right' | 'justify';
const ALIGNS: readonly Align[] = ['left', 'center', 'right', 'justify'];

function align(value: Align): BuiltinDef {
  return {
    kind: 'button',
    commands: ['setTextAlign'],
    toggle: true,
    // Without an explicit alignment the text is left aligned.
    isActive: (e) =>
      value === 'left'
        ? e.isActive({ textAlign: 'left' }) || !ALIGNS.some((a) => e.isActive({ textAlign: a }))
        : e.isActive({ textAlign: value }),
    run: (e) => void e.chain().focus().setTextAlign(value).run(),
  };
}

function mark(name: string, toggle: (e: Editor) => void): BuiltinDef {
  return {
    kind: 'button',
    commands: [`toggle${name[0]?.toUpperCase()}${name.slice(1)}`],
    toggle: true,
    isActive: (e) => e.isActive(name),
    run: toggle,
  };
}

function attrOf(editor: Editor, mark: string, attr: string): string {
  const v: unknown = editor.getAttributes(mark)[attr];
  return typeof v === 'string' ? v : '';
}

/**
 * Rendered font size at the selection in pt, rounded to 0.5 (`'10.5pt'`); '' without layout
 * (SSR, jsdom).
 */
export function effectiveFontSize(editor: Editor): string {
  try {
    const { node } = editor.view.domAtPos(editor.state.selection.from);
    const el = node instanceof Element ? node : node.parentElement;
    const px = el ? parseFloat(getComputedStyle(el).fontSize) : NaN;
    if (!Number.isFinite(px) || px <= 0) return '';
    return `${Math.round(px * 0.75 * 2) / 2}pt`;
  } catch {
    return '';
  }
}

/** Removes every mark of the selection except the guard's preserved unsupported marks. */
function clearFormat(editor: Editor): void {
  editor
    .chain()
    .focus()
    .command(({ tr, state, dispatch }) => {
      if (!dispatch) return true;
      for (const range of state.selection.ranges) {
        for (const type of Object.values(state.schema.marks)) {
          if (type.name === UNSUPPORTED_MARK) continue;
          tr.removeMark(range.$from.pos, range.$to.pos, type);
        }
      }
      if (state.selection.empty) tr.setStoredMarks([]);
      return true;
    })
    .run();
}

export const BUILTIN: Readonly<Record<RcmToolbarItemKey, BuiltinDef>> = {
  undo: {
    kind: 'button',
    commands: ['undo'],
    isDisabled: (e) => !e.can().undo(),
    run: (e) => void e.chain().focus().undo().run(),
  },
  redo: {
    kind: 'button',
    commands: ['redo'],
    isDisabled: (e) => !e.can().redo(),
    run: (e) => void e.chain().focus().redo().run(),
  },
  heading: {
    kind: 'menu',
    commands: ['setParagraph', 'setHeading'],
    // '' = paragraph; '1'–'3' = the heading level of the textblock at the selection.
    value: (e) => (e.isActive('heading') ? String(e.getAttributes('heading').level ?? '') : ''),
  },
  fontFamily: {
    kind: 'menu',
    commands: ['setFontFamily', 'unsetFontFamily'],
    value: (e) => attrOf(e, 'textStyle', 'fontFamily'),
  },
  fontSize: {
    kind: 'menu',
    commands: ['setFontSize'],
    // Without an explicit size the trigger shows the rendered one, like word processors do.
    value: (e) => attrOf(e, 'textStyle', 'fontSize') || effectiveFontSize(e),
  },
  lineHeight: {
    kind: 'menu',
    commands: ['setLineHeight', 'unsetLineHeight'],
    value: (e) => {
      const v: unknown = e.state.selection.$from.parent.attrs.lineHeight;
      return v == null ? '' : String(v);
    },
  },
  bold: mark('bold', (e) => void e.chain().focus().toggleBold().run()),
  italic: mark('italic', (e) => void e.chain().focus().toggleItalic().run()),
  underline: mark('underline', (e) => void e.chain().focus().toggleUnderline().run()),
  strike: mark('strike', (e) => void e.chain().focus().toggleStrike().run()),
  code: mark('code', (e) => void e.chain().focus().toggleCode().run()),
  superscript: mark('superscript', (e) => void e.chain().focus().toggleSuperscript().run()),
  subscript: mark('subscript', (e) => void e.chain().focus().toggleSubscript().run()),
  color: {
    kind: 'popover',
    commands: ['setColor', 'unsetColor'],
    value: (e) => attrOf(e, 'textStyle', 'color'),
  },
  highlight: {
    kind: 'popover',
    commands: ['setHighlight', 'unsetHighlight'],
    isActive: (e) => e.isActive('highlight'),
    value: (e) => attrOf(e, 'highlight', 'color'),
  },
  alignLeft: align('left'),
  alignCenter: align('center'),
  alignRight: align('right'),
  alignJustify: align('justify'),
  indent: {
    kind: 'button',
    commands: ['indent'],
    run: (e) => void e.chain().focus().indent().run(),
  },
  outdent: {
    kind: 'button',
    commands: ['outdent'],
    run: (e) => void e.chain().focus().outdent().run(),
  },
  bulletList: {
    kind: 'button',
    commands: ['toggleBulletList'],
    toggle: true,
    isActive: (e) => e.isActive('bulletList'),
    run: (e) => void e.chain().focus().toggleBulletList().run(),
  },
  orderedList: {
    kind: 'button',
    commands: ['toggleOrderedList'],
    toggle: true,
    isActive: (e) => e.isActive('orderedList'),
    run: (e) => void e.chain().focus().toggleOrderedList().run(),
  },
  taskList: {
    kind: 'button',
    commands: ['toggleTaskList'],
    toggle: true,
    isActive: (e) => e.isActive('taskList'),
    run: (e) => void e.chain().focus().toggleTaskList().run(),
  },
  blockquote: {
    kind: 'button',
    commands: ['toggleBlockquote'],
    toggle: true,
    isActive: (e) => e.isActive('blockquote'),
    run: (e) => void e.chain().focus().toggleBlockquote().run(),
  },
  codeBlock: {
    kind: 'button',
    commands: ['toggleCodeBlock'],
    toggle: true,
    isActive: (e) => e.isActive('codeBlock'),
    run: (e) => void e.chain().focus().toggleCodeBlock().run(),
  },
  horizontalRule: {
    kind: 'button',
    commands: ['setHorizontalRule'],
    run: (e) => void e.chain().focus().setHorizontalRule().run(),
  },
  table: { kind: 'popover', commands: ['insertTable'], isActive: (e) => e.isActive('table') },
  // The control is a button plus a hidden file input (controls.tsx); files go to the pipeline.
  image: { kind: 'button', commands: ['uploadFiles'] },
  // Same, but for any file: without a configured `uploadFile` the pipeline would ignore the
  // chosen file, so the item is omitted (the `data:` link of a fallback would not survive the
  // HTML policy anyway).
  file: { kind: 'button', commands: ['uploadFiles'], available: hasFileUploader },
  // The popover form (controls.tsx) applies `setYoutubeVideo`; the command itself refuses
  // non-YouTube URLs.
  youtube: { kind: 'popover', commands: ['setYoutubeVideo'] },
  link: {
    kind: 'popover',
    commands: ['setLink', 'unsetLink'],
    isActive: (e) => e.isActive('link'),
    value: (e) => attrOf(e, 'link', 'href'),
  },
  clearFormat: { kind: 'button', commands: [], run: clearFormat },
  // Opens the find panel; the click is wired to `ctx.onFind` in controls.tsx.
  find: { kind: 'button', commands: ['setSearchTerm'] },
  // Toggles the HTML source mode; the click is wired to `ctx.onSourceToggle`.
  source: { kind: 'button', commands: [] },
};

const BUILTIN_KEYS = new Set<string>(TOOLBAR_ITEM_KEYS);

export function isBuiltinKey(key: string): key is RcmToolbarItemKey {
  return BUILTIN_KEYS.has(key);
}

export function hasCommands(editor: Editor, commands: readonly string[]): boolean {
  const available = editor.commands as unknown as Record<string, unknown>;
  return commands.every((c) => typeof available[c] === 'function');
}

/**
 * Whether the upload pipeline has a non-image file uploader (`uploadFile`) configured — read
 * live from the extension's storage, so a handler wired in later (the React `uploadFile` prop)
 * is seen too. The upload extension itself is guarded by the `uploadFiles` command check.
 */
export function hasFileUploader(editor: Editor): boolean {
  try {
    const storage = (editor.storage as Partial<Record<'upload', UploadStorage>>).upload;
    return storage?.api?.handlers().uploadFile != null;
  } catch {
    return false;
  }
}

export type ResolvedEntry =
  | { type: 'sep' }
  | { type: 'builtin'; key: RcmToolbarItemKey }
  | { type: 'custom'; item: RcmToolbarCustomItem };

/** The entry list of a config for an editor: missing-command/unavailable items and hidden keys removed. */
export function resolveEntries(config: RcmToolbarConfig, editor: Editor): ResolvedEntry[] {
  const hide = new Set(config.hide ?? []);
  const source = config.items ?? TOOLBAR_PRESETS[config.preset ?? 'full'];
  const out: ResolvedEntry[] = [];
  for (const entry of source) {
    if (entry === '|') {
      out.push({ type: 'sep' });
    } else if (typeof entry === 'string') {
      if (!isBuiltinKey(entry) || hide.has(entry)) continue;
      const def = BUILTIN[entry];
      if (!hasCommands(editor, def.commands)) continue;
      if (def.available && !safe(() => def.available?.(editor) ?? false, false)) continue;
      out.push({ type: 'builtin', key: entry });
    } else if (entry && typeof entry.key === 'string' && !hide.has(entry.key)) {
      out.push({ type: 'custom', item: entry });
    }
  }
  // Tidy: no leading, trailing or doubled separators.
  const tidy: ResolvedEntry[] = [];
  for (const entry of out) {
    if (entry.type === 'sep' && (tidy.length === 0 || tidy[tidy.length - 1]?.type === 'sep')) {
      continue;
    }
    tidy.push(entry);
  }
  if (tidy[tidy.length - 1]?.type === 'sep') tidy.pop();
  return tidy;
}

export function entriesKey(entries: readonly ResolvedEntry[]): string {
  return entries
    .map((e) => (e.type === 'sep' ? '|' : e.type === 'builtin' ? e.key : `custom:${e.item.key}`))
    .join(',');
}

export interface ItemState {
  /** Pressed / active. */
  a: boolean;
  /** Disabled. */
  d: boolean;
  /** Current value (menus, colours, link). */
  v: string;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Per-item state read by `useEditorState` (cheap; compared deeply). */
export function computeState(
  editor: Editor,
  entries: readonly ResolvedEntry[],
): Record<string, ItemState> {
  const out: Record<string, ItemState> = {};
  if (editor.isDestroyed) return out;
  for (const entry of entries) {
    if (entry.type === 'builtin') {
      const def = BUILTIN[entry.key];
      out[entry.key] = {
        a: def.isActive ? safe(() => def.isActive?.(editor) ?? false, false) : false,
        d: def.isDisabled ? safe(() => def.isDisabled?.(editor) ?? false, false) : false,
        v: def.value ? safe(() => def.value?.(editor) ?? '', '') : '',
      };
    } else if (entry.type === 'custom') {
      const item = entry.item;
      out[`custom:${item.key}`] = {
        a: item.isActive ? safe(() => item.isActive?.(editor) ?? false, false) : false,
        d: item.isDisabled ? safe(() => item.isDisabled?.(editor) ?? false, false) : false,
        v: '',
      };
    }
  }
  return out;
}

export function normalizeToolbarProp(
  toolbar: RcmToolbarPreset | RcmToolbarConfig | false | undefined,
): RcmToolbarConfig | null {
  if (toolbar === false) return null;
  if (toolbar === undefined) return { preset: 'full' };
  if (typeof toolbar === 'string') return { preset: toolbar };
  return toolbar;
}
