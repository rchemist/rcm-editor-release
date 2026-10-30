export const VERSION_MARKER = './react';

export { RcmEditor } from './RcmEditor';
export type {
  RcmEditorChange,
  RcmEditorContent,
  RcmEditorHandle,
  RcmEditorProps,
  RcmFontOption,
  RcmToolbarPreset,
  RcmUploadContext,
  RcmUploadResult,
  RcmUploader,
} from './RcmEditor';
export { PrintPreview } from './print/PrintPreview';
export type { PrintPreviewProps } from './print/PrintPreview';
export { DEFAULT_PRINT_PREVIEW_LABELS } from './print/labels';
export type { RcmPrintPreviewLabels } from './print/labels';
export { RcmUploadError } from '../upload/types';
export { DEFAULT_FONTS, TOOLBAR_PRESETS } from './toolbar/items';
export type {
  RcmToolbarConfig,
  RcmToolbarCustomItem,
  RcmToolbarEntry,
  RcmToolbarItemKey,
} from './toolbar/types';
export { DEFAULT_EDITOR_LABELS } from './labels';
export type { RcmEditorLabels } from './labels';
export { STYLES_MISSING_CODE, STYLES_SENTINEL_PROPERTY } from './styleCheck';
export { DEFAULT_FEATURES, FEATURE_NAMES, createEditorExtensions } from '../index';
export type {
  CreateEditorExtensionsOptions,
  EditorFeatureName,
  EditorFeatureOptions,
  EditorFeatures,
  EditorFilesContext,
} from '../index';
export {
  TIPTAP_DUPLICATE_CODE,
  TIPTAP_VERSION,
  detectTiptapDuplicates,
  formatTiptapDuplicateWarning,
} from '../tiptapVersion';
export type { TiptapDuplicateFinding } from '../tiptapVersion';
