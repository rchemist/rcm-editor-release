// Kit assembly started from docparser examples/editor/web/src/schema.ts buildExtensions().
import type { Editor, Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import type { StarterKitOptions } from '@tiptap/starter-kit';
import type { TableKitOptions } from '@tiptap/extension-table';
import { TextAlign } from '@tiptap/extension-text-align';
import type { TextAlignOptions } from '@tiptap/extension-text-align';
import type { HighlightOptions } from '@tiptap/extension-highlight';
import { Subscript } from '@tiptap/extension-subscript';
import type { SubscriptExtensionOptions } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import type { SuperscriptExtensionOptions } from '@tiptap/extension-superscript';
import { FileHandler } from '@tiptap/extension-file-handler';
import type { FileHandlerOptions } from '@tiptap/extension-file-handler';
import { FindAndReplace } from '@tiptap/extension-find-and-replace';
import type { FindAndReplaceOptions } from '@tiptap/extension-find-and-replace';
import { Placeholder } from '@tiptap/extensions';
import type { PlaceholderOptions } from '@tiptap/extensions';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import type { TaskItemOptions, TaskListOptions } from '@tiptap/extension-list';
import { Youtube } from '@tiptap/extension-youtube';
import type { YoutubeOptions } from '@tiptap/extension-youtube';
import { ParagraphAttributes } from '../extensions/paragraphAttributes';
import type { ParagraphAttributesOptions } from '../extensions/paragraphAttributes';
import { TextStyleAttributes } from '../extensions/textStyleAttributes';
import type { TextStyleAttributesOptions } from '../extensions/textStyleAttributes';
import { RcmHighlight, RcmTextStyleKit } from '../extensions/textStyleKit';
import type { RcmTextStyleKitOptions } from '../extensions/textStyleKit';
import { RcmTableKit } from '../extensions/table';
import { RcmImage } from '../extensions/image';
import type { RcmImageOptions, ResolveAsset } from '../extensions/image';
import { Figure } from '../extensions/figure';
import type { FigureOptions } from '../extensions/figure';
import { PageBreak } from '../extensions/pageBreak';
import type { PageBreakOptions } from '../extensions/pageBreak';
import { TextBox } from '../extensions/textBox';
import type { TextBoxOptions } from '../extensions/textBox';
import { Footnotes } from '../extensions/footnotes';
import type { FootnotesOptions } from '../extensions/footnotes';
import { Equation } from '../extensions/equation';
import type { EquationOptions } from '../extensions/equation';
import { ObjectPlaceholder } from '../extensions/objectPlaceholder';
import type { ObjectPlaceholderOptions } from '../extensions/objectPlaceholder';
import { InlineImage } from '../extensions/inlineImage';
import type { InlineImageOptions } from '../extensions/inlineImage';
import { RawHtml } from '../extensions/rawHtml';
import type { RawHtmlOptions } from '../extensions/rawHtml';
import { HtmlFidelity } from '../extensions/htmlFidelity';
import type { HtmlPolicy } from '../html/policy';
import { Upload } from '../extensions/upload';
import type { UploadOptions } from '../extensions/upload';
import { InsertDocument } from '../extensions/insertDocument';
import { PasteNormalizer } from '../paste/plugin';
import { ContentGuard } from '../guard/contentGuard';
import { warnOnce } from '../react/devWarnings';
import type { ContentGuardOptions, ContentReportHandler } from '../guard/contentGuard';

/** tiptap's empty-editor hint, renamed: `placeholder` is the docparser node name (docs/tiptap.md §1). */
const EmptyPlaceholder = Placeholder.extend({ name: 'emptyPlaceholder' });

/**
 * TextStyleKit options minus `lineHeight`: line height is a paragraph/heading attribute owned by
 * `paragraphAttributes` (docparser §1). `fontSize` options configure the pt-defaulting FontSize.
 */
export type TextStyleKitFeatureOptions = RcmTextStyleKitOptions;

/** Options type of every built-in feature, keyed by feature name. */
export interface EditorFeatureOptions {
  starterKit: Partial<StarterKitOptions>;
  tableKit: Partial<TableKitOptions>;
  textStyleKit: Partial<TextStyleKitFeatureOptions>;
  textAlign: Partial<TextAlignOptions>;
  highlight: Partial<HighlightOptions>;
  subscript: Partial<SubscriptExtensionOptions>;
  superscript: Partial<SuperscriptExtensionOptions>;
  image: Partial<RcmImageOptions>;
  /** `<img>` inside paragraph/heading text, kept in place. */
  inlineImage: Partial<InlineImageOptions>;
  /** `figure` + `figcaption` (requires `image`). */
  figure: Partial<FigureOptions>;
  pageBreak: Partial<PageBreakOptions>;
  /** docparser `textBox`. */
  textBox: Partial<TextBoxOptions>;
  /** docparser `footnotes` + `footnote` + `footnoteReference`. */
  footnotes: Partial<FootnotesOptions>;
  /** docparser `equation`. */
  equation: Partial<EquationOptions>;
  /** docparser `placeholder` node (object the renderer could not emit). */
  placeholder: Partial<ObjectPlaceholderOptions>;
  /**
   * Upload pipeline: paste/drop of files and `editor.commands.uploadFiles()`. Uploaders
   * default to `base64Uploader()` for images; the React component fills the handlers from its
   * `uploadImage`/`uploadFile`/`onUploadError` props.
   */
  upload: Partial<UploadOptions>;
  /** tiptap FileHandler: inert unless you give it hooks (the upload pipeline handles paste/drop). */
  fileHandler: Partial<FileHandlerOptions>;
  findAndReplace: Partial<FindAndReplaceOptions>;
  /** tiptap Placeholder (empty-editor hint), registered as `emptyPlaceholder`. */
  emptyPlaceholder: Partial<PlaceholderOptions>;
  taskList: Partial<TaskListOptions>;
  taskItem: Partial<TaskItemOptions>;
  youtube: Partial<YoutubeOptions>;
  paragraphAttributes: Partial<ParagraphAttributesOptions>;
  textStyleAttributes: Partial<TextStyleAttributesOptions>;
  /**
   * Lossless content guard: unknown nodes/marks/attributes are kept (`unsupportedNode`,
   * `unsupportedInline`, `unsupportedMark`, `unsupportedAttrs`) instead of emptying the document.
   * `false` brings back tiptap's own behaviour: content the schema cannot load is dropped
   * silently (an unknown node empties the whole document) and `getLosslessJSON()` is plain
   * `getJSON()`. Disabling it logs a development warning.
   */
  contentGuard: Partial<ContentGuardOptions>;
  /**
   * Verbatim `rawHtml` blocks for HTML the schema cannot round-trip: `getHTML()` renders
   * their source markup as-is, the editing view shows a live preview in a sandboxed `srcdoc`
   * iframe (scripts run only under the `trusted` policy, always in an isolated origin).
   * The preview's policy comes from the guard (`features.contentGuard.htmlPolicy`).
   */
  rawHtml: Partial<RawHtmlOptions>;
  /**
   * `getHTML()` writes inline styles exactly as rendered (font stacks byte for byte in every
   * browser) and keeps literal tabs (`<span style="white-space: pre-wrap">`).
   */
  htmlFidelity: Record<string, never>;
  /**
   * `insertDocument(content, { at, assets })` command: insert a docparser document at the cursor
   *. Assets are merged into `image.resolveAsset` when it is a resolver with `add`.
   */
  insertDocument: Record<string, never>;
  /**
   * Schema-aware paste normalization: Word/HWP junk removal, Word list reconstruction
   * and the schema allowlist run as a `transformPastedHTML` plugin prop before the guard's
   * policy plugin (the policy stays the last word). Drops are reported through
   * `onContentReport` (`source: 'insertContent'`, `format: 'html'`). `false` disables it:
   * paste falls through to ProseMirror defaults.
   */
  paste: Record<string, never>;
}

export type EditorFeatureName = keyof EditorFeatureOptions;

/**
 * Per-feature switch: `false` removes the feature, `true`/omitted keeps our defaults, an options
 * object is merged onto our defaults (plain nested objects merge one level deep, e.g.
 * `starterKit: { link: { autolink: false } }`; arrays and other values replace).
 */
export type EditorFeatures = {
  [K in EditorFeatureName]?: boolean | EditorFeatureOptions[K];
};

/** Context passed to `onFiles` (the upload pipeline). */
export interface EditorFilesContext {
  editor: Editor;
  source: 'paste' | 'drop';
  /** Drop position (drop only). */
  pos?: number;
  /** HTML that came with pasted files (paste only). */
  html?: string;
}

export interface CreateEditorExtensionsOptions {
  features?: EditorFeatures;
  /**
   * Files pasted or dropped into the editor. When omitted the FileHandler stays registered but
   * inert, so pasted/dropped files fall through to the default handling instead of being swallowed.
   */
  onFiles?: (files: File[], context: EditorFilesContext) => void;
  /**
   * Display resolver for `asset:` image srcs (e.g. `asset:sha256:<hex>`, docparser §5). The
   * document JSON/HTML keep the original src. Same as `features.image.resolveAsset`.
   */
  resolveAsset?: ResolveAsset;
  /** Content guard report (unsupported parts of incoming content). Same as `features.contentGuard.onContentReport`. */
  onContentReport?: ContentReportHandler;
  /**
   * HTML input security policy (default `'sanitize'`). Fills `features.contentGuard.htmlPolicy`
   * unless that is set explicitly (the `rawHtml` preview reads it from the guard).
   * Creation-time, like `features`.
   */
  htmlPolicy?: HtmlPolicy;
  /** Hosts whose https `iframe` embeds the `sanitize` policy keeps (default YouTube·Vimeo). */
  iframeHosts?: string[];
}

/** Built-in feature names in kit order. */
export const FEATURE_NAMES: readonly EditorFeatureName[] = [
  'starterKit',
  'tableKit',
  'textStyleKit',
  'textAlign',
  'highlight',
  'subscript',
  'superscript',
  'image',
  'inlineImage',
  'figure',
  'pageBreak',
  'textBox',
  'footnotes',
  'equation',
  'placeholder',
  'upload',
  'fileHandler',
  'findAndReplace',
  'emptyPlaceholder',
  'taskList',
  'taskItem',
  'youtube',
  'paragraphAttributes',
  'textStyleAttributes',
  'paste',
  'contentGuard',
  'rawHtml',
  'htmlFidelity',
  'insertDocument',
];

/** Our defaults per feature (what an options object in `features` is merged onto). */
export const DEFAULT_FEATURES: { readonly [K in EditorFeatureName]: EditorFeatureOptions[K] } = {
  starterKit: {
    // A link click must not navigate away while editing. No default target/rel/class: the
    // link keeps exactly the attributes it came with (tiptap adds target="_blank" and
    // rel="noopener noreferrer nofollow" to every link otherwise).
    link: { openOnClick: false, HTMLAttributes: { target: null, rel: null, class: null } },
    // trailingNode would append a paragraph the source document does not carry (lossless editing).
    trailingNode: false,
  },
  tableKit: { table: { resizable: true } },
  textStyleKit: {},
  textAlign: { types: ['heading', 'paragraph'] },
  highlight: { multicolor: true },
  subscript: {},
  superscript: {},
  // `directions: []`: tiptap draws no handles of its own — the contract handles
  // (`rcm-image-handle`) are rendered by the React image bar. The resizable
  // container itself stays (display, `data-asset-state`).
  image: { resize: { enabled: true, alwaysPreserveAspectRatio: true, directions: [] } },
  inlineImage: { resize: { enabled: true, alwaysPreserveAspectRatio: true, directions: [] } },
  figure: {},
  pageBreak: {},
  textBox: {},
  footnotes: {},
  equation: {},
  placeholder: {},
  upload: {},
  fileHandler: {},
  // The panel's count follows every keystroke, so the search runs synchronously. Highlight
  // styling comes from our tokens (editor.css, dark mode included) instead of the extension's
  // global <style> injection.
  findAndReplace: { searchDebounceMs: 0, injectCSS: false },
  // Visible text is injected through labels (T3.x); no built-in English string.
  emptyPlaceholder: { placeholder: '' },
  taskList: {},
  taskItem: { nested: true },
  youtube: {},
  paragraphAttributes: {},
  textStyleAttributes: {},
  paste: {},
  contentGuard: {},
  rawHtml: {},
  htmlFidelity: {},
  insertDocument: {},
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
  );
}

function mergeOptions<T extends object>(defaults: T, override: Partial<T>): T {
  const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override)) {
    const base = out[key];
    out[key] = isPlainObject(base) && isPlainObject(value) ? { ...base, ...value } : value;
  }
  return out as T;
}

/** Resolved options for `name`, or null when the feature is disabled. */
export function resolveFeature<K extends EditorFeatureName>(
  features: EditorFeatures | undefined,
  name: K,
): EditorFeatureOptions[K] | null {
  const value = features?.[name];
  if (value === false) return null;
  const defaults = DEFAULT_FEATURES[name];
  if (value === undefined || value === true) return { ...defaults };
  return mergeOptions(defaults, value as EditorFeatureOptions[K]);
}

/**
 * The editor schema kit: StarterKit (incl. link/underline), TableKit (docparser cell + editor
 * table attributes), TextStyleKit, TextAlign, Highlight, Sub/Superscript, Image (align,
 * resolveAsset), figure/figcaption, pageBreak, the docparser textBox/footnotes/equation/placeholder
 * nodes, FileHandler, FindAndReplace, the empty-editor hint, TaskList/TaskItem, Youtube, the
 * docparser paragraph/textStyle attributes, inlineImage and the lossless content guard. Framework-agnostic: usable with a
 * docparser paragraph/textStyle attributes, inlineImage, the `rawHtml` verbatim blocks and the
 * lossless content guard. Framework-agnostic: usable with a
 * plain `@tiptap/core` `Editor`.
 */
export function createEditorExtensions(options: CreateEditorExtensionsOptions = {}): Extensions {
  const { features, onFiles, resolveAsset, onContentReport, htmlPolicy, iframeHosts } = options;
  const list: Extensions = [];
  const on = <K extends EditorFeatureName>(
    name: K,
    build: (o: EditorFeatureOptions[K]) => void,
  ) => {
    const resolved = resolveFeature(features, name);
    if (resolved) build(resolved);
  };

  on('starterKit', (o) => list.push(StarterKit.configure(o)));
  on('tableKit', (o) => list.push(RcmTableKit.configure(o)));
  on('textStyleKit', (o) => list.push(RcmTextStyleKit.configure(o)));
  on('textAlign', (o) => list.push(TextAlign.configure(o)));
  on('highlight', (o) => list.push(RcmHighlight.configure(o)));
  on('subscript', (o) => list.push(Subscript.configure(o)));
  on('superscript', (o) => list.push(Superscript.configure(o)));
  on('image', (o) =>
    list.push(RcmImage.configure(resolveAsset && !o.resolveAsset ? { ...o, resolveAsset } : o)),
  );
  on('inlineImage', (o) =>
    list.push(InlineImage.configure(resolveAsset && !o.resolveAsset ? { ...o, resolveAsset } : o)),
  );
  // figure's content expression names `image`: without the image node it cannot exist.
  if (resolveFeature(features, 'image')) on('figure', (o) => list.push(Figure.configure(o)));
  on('pageBreak', (o) => list.push(PageBreak.configure(o)));
  on('textBox', (o) => list.push(TextBox.configure(o)));
  on('footnotes', (o) => list.push(Footnotes.configure(o)));
  on('equation', (o) => list.push(Equation.configure(o)));
  on('placeholder', (o) => list.push(ObjectPlaceholder.configure(o)));
  on('upload', (o) => list.push(Upload.configure(o)));
  on('fileHandler', (o) => {
    const hooks: Partial<FileHandlerOptions> = onFiles
      ? {
          onPaste: (editor, files, html) => onFiles(files, { editor, source: 'paste', html }),
          onDrop: (editor, files, pos) => onFiles(files, { editor, source: 'drop', pos }),
        }
      : {};
    list.push(FileHandler.configure({ ...hooks, ...o }));
  });
  on('findAndReplace', (o) => list.push(FindAndReplace.configure(o)));
  on('emptyPlaceholder', (o) => list.push(EmptyPlaceholder.configure(o)));
  on('taskList', (o) => list.push(TaskList.configure(o)));
  on('taskItem', (o) => list.push(TaskItem.configure(o)));
  on('youtube', (o) => list.push(Youtube.configure(o)));
  on('paragraphAttributes', (o) => list.push(ParagraphAttributes.configure(o)));
  on('textStyleAttributes', (o) => list.push(TextStyleAttributes.configure(o)));
  // Before the content guard: ProseMirror chains `transformPastedHTML` props in plugin order,
  // so the normalizer runs before the guard's policy plugin.
  on('paste', () => list.push(PasteNormalizer));
  if (!resolveFeature(features, 'contentGuard'))
    warnOnce(
      'content-guard-off',
      () =>
        '[@rchemist/editor] features.contentGuard is false: content the schema cannot load is ' +
        'dropped silently (an unknown node empties the document). Keep the guard on unless you ' +
        'validate content yourself.',
    );
  on('contentGuard', (o) =>
    list.push(
      ContentGuard.configure({
        ...(onContentReport && !o.onContentReport ? { onContentReport } : {}),
        ...(htmlPolicy !== undefined && o.htmlPolicy == null ? { htmlPolicy } : {}),
        ...(iframeHosts !== undefined && o.iframeHosts == null ? { iframeHosts } : {}),
        ...o,
      }),
    ),
  );
  // `rawHtml` reads the effective policy from the guard (`htmlPolicyOf`); its own
  // `policy` option stays only as the fallback for editors without the guard.
  on('rawHtml', (o) => list.push(RawHtml.configure(o)));
  on('htmlFidelity', () => list.push(HtmlFidelity));
  on('insertDocument', () => list.push(InsertDocument));
  return list;
}
