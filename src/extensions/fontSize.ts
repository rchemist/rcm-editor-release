import { FontSize } from '@tiptap/extension-text-style';

/**
 * `"12"` / `12` → `"12pt"` (pt is the editor's default unit); values with a unit (`"14px"`,
 * `"1.2em"`) are kept as given.
 */
export function normalizeFontSize(size: string | number): string {
  const raw = String(size).trim();
  return /^\d+(?:\.\d+)?$/.test(raw) ? `${raw}pt` : raw;
}

/** tiptap FontSize whose `setFontSize` defaults unitless numbers to pt. Parsing keeps the raw value. */
export const RcmFontSize = FontSize.extend({
  addCommands() {
    return {
      ...this.parent?.(),
      setFontSize:
        (fontSize: string) =>
        ({ chain }) =>
          chain()
            .setMark('textStyle', { fontSize: normalizeFontSize(fontSize) })
            .run(),
    };
  },
});
