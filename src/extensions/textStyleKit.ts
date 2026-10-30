import { Extension } from '@tiptap/core';
import type { AnyExtension, Attribute, GlobalAttributes } from '@tiptap/core';
import { BackgroundColor, Color, FontFamily, TextStyle } from '@tiptap/extension-text-style';
import type { TextStyleKitOptions } from '@tiptap/extension-text-style';
import { Highlight } from '@tiptap/extension-highlight';
import type { TagParseRule } from '@tiptap/pm/model';
import { emptyToNull, normalizeColor } from './cssLength';
import { RcmFontSize } from './fontSize';
import { isWhitespaceOnlySpan } from './htmlFidelity';

type Normalize = (value: unknown) => string | null;

/**
 * Wraps every global attribute's parseHTML with `normalize`. tiptap's text-style members fall
 * back to `element.style.x`, which yields `""` for absent properties and `rgb()` for colours;
 * docparser JSON has the attribute absent and colours as `#rrggbb`.
 */
function normalizeParse<E extends AnyExtension>(extension: E, normalize: Normalize): E {
  return extension.extend({
    addGlobalAttributes() {
      const parent = (this.parent?.() ?? []) as GlobalAttributes;
      return parent.map((group) => ({
        ...group,
        attributes: Object.fromEntries(
          Object.entries(group.attributes).map(([name, attribute]) => [
            name,
            {
              ...attribute,
              parseHTML: (element: HTMLElement) =>
                normalize(attribute?.parseHTML ? attribute.parseHTML(element) : null),
            },
          ]),
        ),
      }));
    },
  }) as E;
}

export const RcmColor = normalizeParse(Color, normalizeColor);
export const RcmBackgroundColor = normalizeParse(BackgroundColor, normalizeColor);
export const RcmFontFamily = normalizeParse(FontFamily, emptyToNull);
const RcmFontSizeParsed = normalizeParse(RcmFontSize, emptyToNull);

/**
 * TextStyle whose span rule skips spans styled only with `white-space` (the tab wrapper of
 * `HtmlFidelity`, Google Docs' `pre-wrap` spans): they carry no text style, so no empty
 * `textStyle` mark.
 */
export const RcmTextStyle = TextStyle.extend({
  parseHTML() {
    const rules = (this.parent?.() ?? []) as TagParseRule[];
    return rules.map((rule) => ({
      ...rule,
      getAttrs: (element: HTMLElement) =>
        isWhitespaceOnlySpan(element) ? false : rule.getAttrs ? rule.getAttrs(element) : null,
    }));
  },
});

/** Highlight (multicolour) whose `color` parses opaque rgb() back to `#rrggbb`. */
export const RcmHighlight = Highlight.extend({
  addAttributes() {
    const parent: Record<string, Attribute> = this.parent?.() ?? {};
    const color = parent.color;
    if (!color || !this.options.multicolor) return parent;
    return {
      ...parent,
      color: {
        ...color,
        parseHTML: (element: HTMLElement) =>
          normalizeColor(color.parseHTML ? color.parseHTML(element) : null),
      },
    };
  },
});

/** TextStyleKit options without `lineHeight` (owned by `paragraphAttributes`). */
export type RcmTextStyleKitOptions = Omit<TextStyleKitOptions, 'lineHeight'>;

/**
 * Same composition and option shape as tiptap's TextStyleKit (TextStyle, Color, BackgroundColor,
 * FontFamily, FontSize) minus LineHeight, with docparser-normalised parsing and a FontSize whose
 * `setFontSize` defaults to pt.
 */
export const RcmTextStyleKit = Extension.create<RcmTextStyleKitOptions>({
  name: 'textStyleKit',

  addExtensions() {
    const o = this.options;
    const list: AnyExtension[] = [];
    if (o.backgroundColor !== false) list.push(RcmBackgroundColor.configure(o.backgroundColor));
    if (o.color !== false) list.push(RcmColor.configure(o.color));
    if (o.fontFamily !== false) list.push(RcmFontFamily.configure(o.fontFamily));
    if (o.fontSize !== false) list.push(RcmFontSizeParsed.configure(o.fontSize));
    if (o.textStyle !== false) list.push(RcmTextStyle.configure(o.textStyle));
    return list;
  },
});
