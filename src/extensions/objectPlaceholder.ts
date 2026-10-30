// Ported from docparser examples/editor/web/src/schema.ts (DocParserPlaceholder), docparser docs/tiptap.md §1.
import { Node, mergeAttributes } from '@tiptap/core';
import { fillLabel } from './labels';

export const PLACEHOLDER_KINDS = ['image', 'chart', 'ole', 'unknown'] as const;
export const PLACEHOLDER_REASONS = [
  'unsupported_format',
  'limit_exceeded',
  'missing_binary',
  'unknown',
] as const;
export type PlaceholderKind = (typeof PLACEHOLDER_KINDS)[number];
export type PlaceholderReason = (typeof PLACEHOLDER_REASONS)[number];

/**
 * Label keys: `kind.<kind>`, `reason.<reason>`, a specific `<kind>.<reason>` phrase, and
 * `template` (`{kind}`/`{reason}`) used when no specific phrase applies. A default specific phrase
 * is not used once `kind.<kind>` or `reason.<reason>` is injected (so a translation of the parts
 * is not overridden by a Korean default phrase).
 */
export const PLACEHOLDER_LABEL_KEYS = [
  'template',
  ...PLACEHOLDER_KINDS.map((k) => `kind.${k}` as const),
  ...PLACEHOLDER_REASONS.map((r) => `reason.${r}` as const),
  ...PLACEHOLDER_KINDS.flatMap((k) => PLACEHOLDER_REASONS.map((r) => `${k}.${r}` as const)),
] as const;
export type PlaceholderLabelKey = (typeof PLACEHOLDER_LABEL_KEYS)[number];
export type PlaceholderLabels = Partial<Record<PlaceholderLabelKey, string>>;

export const DEFAULT_PLACEHOLDER_LABELS: PlaceholderLabels = {
  template: '{kind}: {reason}',
  'kind.image': '그림',
  'kind.chart': '차트',
  'kind.ole': 'OLE 개체',
  'kind.unknown': '개체',
  'reason.unsupported_format': '지원하지 않는 형식',
  'reason.limit_exceeded': '크기 제한 초과',
  'reason.missing_binary': '데이터 없음',
  'reason.unknown': '표시할 수 없음',
  'image.unsupported_format': '지원하지 않는 그림 형식',
  'image.missing_binary': '그림 데이터 없음',
  'image.limit_exceeded': '그림 크기 제한 초과',
  'chart.missing_binary': '차트 데이터 없음',
  'ole.missing_binary': 'OLE 개체 데이터 없음',
};

export interface ObjectPlaceholderOptions {
  HTMLAttributes: Record<string, unknown>;
  /** Visible text per kind × reason (merged onto the Korean defaults). */
  labels: PlaceholderLabels;
}

const nonEmpty = (value: string | undefined): string | undefined =>
  value && value.trim() !== '' ? value : undefined;

/** Visible text for `kind` × `reason`; never empty (falls back to the defaults, then the raw values). */
export function placeholderLabel(
  kind: unknown,
  reason: unknown,
  labels: PlaceholderLabels = {},
): string {
  const k = String(kind ?? 'unknown');
  const r = String(reason ?? 'unknown');
  const custom: Record<string, string | undefined> = labels;
  const defaults: Record<string, string | undefined> = DEFAULT_PLACEHOLDER_LABELS;
  // A blank injected label falls back to the default of the same key.
  const get = (key: string) => nonEmpty(custom[key]) ?? nonEmpty(defaults[key]);
  // A default kind×reason phrase is skipped when the kind or reason label was injected.
  const customised = nonEmpty(custom[`kind.${k}`]) ?? nonEmpty(custom[`reason.${r}`]);
  const specific =
    nonEmpty(custom[`${k}.${r}`]) ?? (customised ? undefined : nonEmpty(defaults[`${k}.${r}`]));
  if (specific) return specific;
  const kindLabel = get(`kind.${k}`) ?? get('kind.unknown') ?? k;
  const reasonLabel = get(`reason.${r}`) ?? get('reason.unknown') ?? r;
  const template = get('template') ?? '{kind}: {reason}';
  return nonEmpty(fillLabel(template, { kind: kindLabel, reason: reasonLabel })) ?? `${k}/${r}`;
}

/**
 * docparser `placeholder` block atom (`kind`, `reason`): an object the renderer could not emit,
 * shown as a visible box with a marker and a label. (The empty-editor hint extension is
 * registered as `emptyPlaceholder`.)
 */
export const ObjectPlaceholder = Node.create<ObjectPlaceholderOptions>({
  name: 'placeholder',
  group: 'block',
  atom: true,
  selectable: true,

  addOptions() {
    return { HTMLAttributes: {}, labels: {} };
  },

  addAttributes() {
    return {
      kind: {
        default: 'unknown',
        parseHTML: (el) => el.getAttribute('data-kind') ?? 'unknown',
        renderHTML: (a) => ({ 'data-kind': a.kind }),
      },
      reason: {
        default: 'unknown',
        parseHTML: (el) => el.getAttribute('data-reason') ?? 'unknown',
        renderHTML: (a) => ({ 'data-reason': a.reason }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="placeholder"]', priority: 100 }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = placeholderLabel(node.attrs.kind, node.attrs.reason, this.options.labels);
    return [
      'div',
      mergeAttributes(
        {
          class: 'rcm-placeholder',
          'data-type': 'placeholder',
          role: 'img',
          'aria-label': label,
        },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      ['span', { class: 'rcm-placeholder-icon', 'aria-hidden': 'true' }],
      ['span', { class: 'rcm-placeholder-label' }, label],
    ];
  },
});
