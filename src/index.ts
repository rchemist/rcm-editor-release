export const VERSION_MARKER = '.';

export {
  DEFAULT_FEATURES,
  FEATURE_NAMES,
  createEditorExtensions,
  resolveFeature,
} from './schema/kit';
export type {
  CreateEditorExtensionsOptions,
  EditorFeatureName,
  EditorFeatureOptions,
  EditorFeatures,
  EditorFilesContext,
  TextStyleKitFeatureOptions,
} from './schema/kit';
export { PARAGRAPH_STYLE_ATTRIBUTES, ParagraphAttributes } from './extensions/paragraphAttributes';
export type { ParagraphAttributesOptions } from './extensions/paragraphAttributes';
export { TextStyleAttributes } from './extensions/textStyleAttributes';
export type { TextStyleAttributesOptions } from './extensions/textStyleAttributes';
export { RcmFontSize, normalizeFontSize } from './extensions/fontSize';
export { fontStack } from './extensions/fontStack';
export {
  RcmTable,
  RcmTableCell,
  RcmTableHeader,
  RcmTableKit,
  RcmTableView,
  cellAttributes,
} from './extensions/table';
export type { CellBorderSide, CellVerticalAlign, TableAlign, TableWidth } from './extensions/table';
export { RcmImage, isAssetSrc, parseImageAlign } from './extensions/image';
export type { ImageAlign, RcmImageOptions, ResolveAsset } from './extensions/image';
export { Figcaption, Figure } from './extensions/figure';
export type { FigcaptionOptions, FigureOptions } from './extensions/figure';
export { PageBreak } from './extensions/pageBreak';
export type { PageBreakOptions } from './extensions/pageBreak';
export { TextBox } from './extensions/textBox';
export type { TextBoxOptions } from './extensions/textBox';
export {
  DEFAULT_FOOTNOTE_LABELS,
  FOOTNOTE_LABEL_KEYS,
  Footnote,
  FootnoteReference,
  Footnotes,
} from './extensions/footnotes';
export type { FootnoteLabelKey, FootnoteLabels, FootnotesOptions } from './extensions/footnotes';
export {
  DEFAULT_EQUATION_LABELS,
  EQUATION_EDIT_EVENT,
  EQUATION_LABEL_KEYS,
  Equation,
} from './extensions/equation';
export type { EquationLabelKey, EquationLabels, EquationOptions } from './extensions/equation';
export {
  DEFAULT_PLACEHOLDER_LABELS,
  ObjectPlaceholder,
  PLACEHOLDER_KINDS,
  PLACEHOLDER_LABEL_KEYS,
  PLACEHOLDER_REASONS,
  placeholderLabel,
} from './extensions/objectPlaceholder';
export type {
  ObjectPlaceholderOptions,
  PlaceholderKind,
  PlaceholderLabelKey,
  PlaceholderLabels,
  PlaceholderReason,
} from './extensions/objectPlaceholder';

export {
  TIPTAP_DUPLICATE_CODE,
  TIPTAP_VERSION,
  detectTiptapDuplicates,
  formatTiptapDuplicateWarning,
} from './tiptapVersion';
export type { TiptapDuplicateFinding } from './tiptapVersion';

export { InlineImage } from './extensions/inlineImage';
export type { InlineImageOptions } from './extensions/inlineImage';
export { RAW_HTML, RAW_HTML_ATTR, RawHtml, expandRawHtmlPlaceholders } from './extensions/rawHtml';
export type { RawHtmlOptions } from './extensions/rawHtml';
export { HtmlFidelity, isWhitespaceOnlySpan, patchHtmlSerializer } from './extensions/htmlFidelity';
export { RcmTextStyle } from './extensions/textStyleKit';
export { InsertDocument } from './extensions/insertDocument';
export type {
  InsertDocumentContent,
  InsertDocumentExtensionOptions,
  InsertDocumentOptions,
} from './extensions/insertDocument';
export type { DocparserAsset } from './docparser/types';

export {
  CONTENT_LOAD_META,
  ContentGuard,
  GUARD_REPLACE_META,
  isPolicyFixup,
  emitContentReport,
  contentGuardEditorOptions,
  getContentReport,
  getLosslessHTML,
  getLosslessJSON,
  peekLosslessHtml,
  handleContentError,
  isContentLocked,
  setEditorEditable,
} from './guard/contentGuard';
export { DEFAULT_IFRAME_HOSTS, applyHtmlPolicy, isAllowedIframeSrc } from './html/policy';
export type {
  ApplyPolicyOptions,
  ApplyPolicyResult,
  HtmlPolicy,
  HtmlPolicyContext,
  HtmlPolicyFn,
  PolicyRemovedEntry,
  PolicyRemovedKind,
} from './html/policy';
export { preserveHtmlForLoad } from './html/preserve';
export type { PreserveOptions, PreserveResult, RawHtmlEntry, RawHtmlReason } from './html/preserve';
export { unwrapHtmlCodeBlocks } from './html/unwrap';
export type {
  ContentGuardOptions,
  ContentGuardStorage,
  ContentReportHandler,
  PreprocessHtml,
} from './guard/contentGuard';
export { guardDocument, guardFragment, scanUnknownHtml, unwrapUnsupported } from './guard/guard';
export type {
  ContentReport,
  GuardedDocument,
  UnknownHtmlEntry,
  UnsupportedEntry,
  UnsupportedKind,
} from './guard/guard';
export {
  DEFAULT_UNSUPPORTED_LABELS,
  UNSUPPORTED_ATTRS,
  UNSUPPORTED_INLINE,
  UNSUPPORTED_LABEL_KEYS,
  UNSUPPORTED_MARK,
  UNSUPPORTED_NODE,
  UnsupportedInline,
  UnsupportedMark,
  UnsupportedNode,
} from './guard/unsupported';
export type {
  UnsupportedLabelKey,
  UnsupportedLabels,
  UnsupportedMarkJson,
  UnsupportedNodeOptions,
} from './guard/unsupported';

export { diffDocs, normalizeDoc, stableStringify } from './diagnostics/normalize';
export type { JsonDifference } from './diagnostics/normalize';
export { diagnoseRoundtrip, diffStructure, formatRoundtripDiffs } from './diagnostics/roundtrip';
export type {
  DiagnoseRoundtripOptions,
  RoundtripDiagnosis,
  RoundtripDiff,
  RoundtripDiffKind,
} from './diagnostics/roundtrip';

export { DEFAULT_UPLOAD_LABELS, UPLOAD_PLUGIN_KEY, Upload } from './extensions/upload';
export type {
  UploadFilesOptions,
  UploadHandlers,
  UploadLabels,
  UploadOptions,
  UploadStorage,
} from './extensions/upload';
export { RcmUploadError } from './upload/types';
export type {
  RcmUploadContext,
  RcmUploadErrorCode,
  RcmUploadResult,
  RcmUploader,
  UploadErrorHandler,
  UploadPolicy,
  UploadResize,
} from './upload/types';
export { refreshAssets } from './extensions/image';
