/**
 * Korean font stacks — exact port of docparser `tiptap/fonts.go` `FontFamily` (byte-identical
 * output): the source font name first (quoted, escaped), then its web substitute. Commercial
 * faces (함초롬, 맑은 고딕, 바탕/돋움/굴림/궁서, HY 계열 …) are referenced by name only — the
 * file never enters the repo; Noto Sans KR / Noto Serif KR (OFL, `fonts/`) render them.
 */

const SERIF_NAMES = new Set([
  '함초롬바탕',
  '한컴바탕',
  '바탕',
  '바탕체',
  '궁서',
  '나눔명조',
  '휴먼명조',
]);

const SANS_NAMES = new Set([
  '함초롬돋움',
  '한컴돋움',
  '돋움',
  '돋움체',
  '굴림',
  '굴림체',
  '맑은 고딕',
  '나눔고딕',
  'HY헤드라인M',
  'HY견고딕',
]);

/** `"A\"B\\C"` — backslash then quote, like Go's single-pass `strings.NewReplacer`. */
function quote(name: string): string {
  return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * The font stack for a docparser font name: the original name first (quoted, escaped),
 * `"HCR Batang"`/`"HCR Dotum"` for 함초롬, then `"Noto Serif KR", serif` / `"Noto Sans KR",
 * sans-serif` / MYUNGJO family → `serif` / default `sans-serif`.
 */
export function fontStack(name: string, family = ''): string {
  let prefix = `${quote(name)}, `;
  if (name === '함초롬바탕') prefix += `"HCR Batang", `;
  if (name === '함초롬돋움') prefix += `"HCR Dotum", `;
  if (SERIF_NAMES.has(name)) return `${prefix}"Noto Serif KR", serif`;
  if (SANS_NAMES.has(name)) return `${prefix}"Noto Sans KR", sans-serif`;
  // Go strings.EqualFold over the three ASCII/Korean constants; toLowerCase() matches those.
  const folded = family.toLowerCase();
  if (folded === 'myungjo' || folded === 'fcat_myungjo' || folded === '명조')
    return `${prefix}serif`;
  return `${prefix}sans-serif`;
}
