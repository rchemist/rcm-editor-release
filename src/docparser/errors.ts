export type DocparserImportErrorCode =
  /** The response is not an object, or has neither/both of `doc` and `docs`, or bad `warnings`. */
  | 'invalid_response'
  /** A `doc` is not a tiptap document (`{type: "doc", content?: node[]}`). */
  | 'invalid_doc'
  /** An `assets[]` entry is malformed. */
  | 'invalid_asset'
  /** A bad option (`ranges`, `separator`, `index`). */
  | 'invalid_option'
  /** `index` selects a range the response does not have. */
  | 'range_out_of_bounds';

/** Thrown by the docparser import adapter on malformed input; branch on `code`. */
export class DocparserImportError extends Error {
  readonly code: DocparserImportErrorCode;

  constructor(code: DocparserImportErrorCode, message: string) {
    super(message);
    this.name = 'DocparserImportError';
    this.code = code;
  }
}
