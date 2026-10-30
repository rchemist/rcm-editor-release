// Types for ./buildRequest.mjs (untyped example helper; resolved by tsc, unused at runtime).
export declare function fontBasename(relPath: string): string;
export declare function extractFontRefs(fontCssText: string): string[];
export declare function rewriteFontCssBasenames(fontCssText: string): string;
export declare function preferNotoFontVars(htmlText: string): string;
export declare function marginBoxNotoCss(): string;
export declare function hoistLeadingHeaderRow(doc: Document): number;
export declare function buildFormFields(): Record<string, string>;
