// docparser textStyle attributes (docs/tiptap.md §1): letterSpacing (em string), fontStretch (% string).
import '@tiptap/extension-text-style';
import { Extension } from '@tiptap/core';
import { readStyle, styleDecl } from './cssLength';

export interface TextStyleAttributesOptions {
  /** Mark types carrying the attributes. */
  types: string[];
}

declare module '@tiptap/extension-text-style' {
  interface TextStyleAttributes {
    letterSpacing?: string | null;
    fontStretch?: string | null;
  }
}

/** `letterSpacing` ↔ `letter-spacing`, `fontStretch` ↔ `font-stretch`; raw values preserved. */
export const TextStyleAttributes = Extension.create<TextStyleAttributesOptions>({
  name: 'textStyleAttributes',

  addOptions() {
    return { types: ['textStyle'] };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          letterSpacing: {
            default: null,
            parseHTML: (element) => readStyle(element, 'letter-spacing'),
            renderHTML: (attributes) => styleDecl('letter-spacing', attributes.letterSpacing),
          },
          fontStretch: {
            default: null,
            parseHTML: (element) => readStyle(element, 'font-stretch'),
            renderHTML: (attributes) => styleDecl('font-stretch', attributes.fontStretch),
          },
        },
      },
    ];
  },
});
