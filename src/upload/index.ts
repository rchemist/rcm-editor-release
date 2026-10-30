export const VERSION_MARKER = './upload';

export { RcmUploadError } from './types';
export type {
  RcmUploadContext,
  RcmUploadErrorCode,
  RcmUploadResult,
  RcmUploader,
  UploadErrorHandler,
  UploadPolicy,
  UploadResize,
} from './types';
export { matchesAccept, preparePolicyFile, resizeImage, withPolicy } from './policy';
export {
  DEFAULT_BASE64_MAX_BYTES,
  base64Uploader,
  httpUploader,
  normalizeUploadResult,
  presignedUploader,
} from './uploaders';
export type { HttpUploaderOptions, PresignedTarget, PresignedUploaderOptions } from './uploaders';
