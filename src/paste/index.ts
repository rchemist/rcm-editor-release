// Headless paste normalization (`@rchemist/editor/paste`).
export const VERSION_MARKER = './paste';
export { normalizePastedHtml } from './normalize';
export type {
  HwpClipboardFormat,
  NormalizePastedHtmlOptions,
  NormalizePastedHtmlResult,
  PasteDropped,
} from './normalize';
export {
  classifyHwpClipboardProvenance,
  isHwpClipboardHtml,
  isWordClipboardHtml,
} from './normalize';
