// Round-trip diagnostic reporter: what an editor load (and optional HTML trip) loses.
import { Editor } from '@tiptap/core';
import type { Extensions, JSONContent } from '@tiptap/core';
import { getContentReport, getLosslessJSON } from '../guard/contentGuard';
import type { UnsupportedEntry } from '../guard/guard';
import { normalizeDoc, typeLabel } from './normalize';
import type { Json } from './normalize';

export type RoundtripDiffKind =
  | 'missing-node'
  | 'added-node'
  | 'node-type-changed'
  | 'text-changed'
  | 'attr-dropped'
  | 'attr-added'
  | 'attr-changed'
  | 'mark-dropped'
  | 'mark-added'
  | 'mark-changed';

export interface RoundtripDiff {
  /** e.g. `content[3](paragraph).attrs.lineHeight`, `content[0](paragraph).content[1](text).marks(bold)`. */
  path: string;
  kind: RoundtripDiffKind;
  before: unknown;
  after: unknown;
}

export interface RoundtripDiagnosis {
  lossless: boolean;
  diffs: RoundtripDiff[];
  /** Parts the content guard had to wrap (kept, but not editable as their own type). */
  unsupported: UnsupportedEntry[];
  /** Output compared with the input (`getLosslessJSON` of the last editor). */
  output: JSONContent;
}

export interface DiagnoseRoundtripOptions {
  /**
   * `json` (default): load → `getLosslessJSON()`. `html`: load → `getHTML()` → load that HTML in a
   * fresh editor → `getLosslessJSON()` (needs a DOM).
   */
  via?: 'json' | 'html';
}

type Obj = { [key: string]: Json };
const isObj = (v: Json | undefined): v is Obj =>
  v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v);

/** Structural difference of two normalised docs (see `RoundtripDiffKind`). */
export function diffStructure(before: unknown, after: unknown): RoundtripDiff[] {
  const out: RoundtripDiff[] = [];
  compareNode(normalizeDoc(before), normalizeDoc(after), '', out);
  return out;
}

function compareNode(b: Json, a: Json, path: string, out: RoundtripDiff[]): void {
  if (!isObj(b) || !isObj(a)) {
    if (JSON.stringify(b) !== JSON.stringify(a))
      out.push({ path, kind: 'node-type-changed', before: b, after: a });
    return;
  }
  if (b.type !== a.type) {
    out.push({ path, kind: 'node-type-changed', before: b.type, after: a.type });
    return;
  }
  if (b.text !== a.text)
    out.push({ path: `${path}.text`, kind: 'text-changed', before: b.text, after: a.text });
  compareAttrs(b.attrs, a.attrs, `${path}.attrs`, 'attr', out);
  compareMarks(b.marks, a.marks, path, out);
  const bc = Array.isArray(b.content) ? b.content : [];
  const ac = Array.isArray(a.content) ? a.content : [];
  for (const [i, j] of align(bc, ac)) {
    const item = i !== null ? bc[i]! : ac[j!]!;
    const at = `${path ? `${path}.` : ''}content[${i ?? j}]${typeLabel(item)}`;
    if (i === null) out.push({ path: at, kind: 'added-node', before: null, after: ac[j!] });
    else if (j === null) out.push({ path: at, kind: 'missing-node', before: bc[i], after: null });
    else compareNode(bc[i]!, ac[j]!, at, out);
  }
}

function compareAttrs(
  b: Json | undefined,
  a: Json | undefined,
  path: string,
  prefix: 'attr' | 'mark',
  out: RoundtripDiff[],
): void {
  const before = isObj(b) ? b : {};
  const after = isObj(a) ? a : {};
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const x = before[key];
    const y = after[key];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    const kind =
      y === undefined
        ? (`${prefix}-dropped` as const)
        : x === undefined
          ? (`${prefix}-added` as const)
          : (`${prefix}-changed` as const);
    out.push({
      path: `${path}.${key}`,
      kind: prefix === 'attr' ? kind : 'mark-changed',
      before: x ?? null,
      after: y ?? null,
    });
  }
}

function compareMarks(
  b: Json | undefined,
  a: Json | undefined,
  path: string,
  out: RoundtripDiff[],
) {
  const group = (list: Json | undefined) => {
    const map = new Map<string, Obj[]>();
    for (const m of Array.isArray(list) ? list : []) {
      if (!isObj(m)) continue;
      const key = String(m.type);
      map.set(key, [...(map.get(key) ?? []), m]);
    }
    return map;
  };
  const before = group(b);
  const after = group(a);
  for (const type of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const x = before.get(type) ?? [];
    const y = after.get(type) ?? [];
    const at = `${path}.marks(${type})`;
    for (let k = 0; k < Math.max(x.length, y.length); k++) {
      if (!y[k]) out.push({ path: at, kind: 'mark-dropped', before: x[k], after: null });
      else if (!x[k]) out.push({ path: at, kind: 'mark-added', before: null, after: y[k] });
      else compareAttrs(x[k]!.attrs, y[k]!.attrs, `${at}.attrs`, 'mark', out);
    }
  }
}

/** Index pairs aligning two child lists by node type (LCS when the lengths differ). */
function align(b: Json[], a: Json[]): [number | null, number | null][] {
  if (b.length === a.length) return b.map((_, i) => [i, i]);
  const key = (n: Json) => (isObj(n) ? `${String(n.type)}` : JSON.stringify(n));
  const bk = b.map(key);
  const ak = a.map(key);
  const n = bk.length;
  const m = ak.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[i]![j] =
        bk[i] === ak[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const pairs: [number | null, number | null][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (bk[i] === ak[j]) pairs.push([i++, j++]);
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) pairs.push([i++, null]);
    else pairs.push([null, j++]);
  }
  while (i < n) pairs.push([i++, null]);
  while (j < m) pairs.push([null, j++]);
  return pairs;
}

function load(content: JSONContent | string, extensions: Extensions): Editor {
  return new Editor({
    extensions,
    content,
    element: typeof document !== 'undefined' ? document.createElement('div') : null,
  });
}

/**
 * Loads `json` into a headless editor with `extensions` (e.g. `createEditorExtensions()`) and
 * reports every difference between the input and what comes back — dropped nodes, attributes and
 * marks, changed values — after the same normalisation as the fixture gate (null attributes, mark
 * order and split text runs are not differences). `lossless` is true when `diffs` is empty.
 */
export function diagnoseRoundtrip(
  json: JSONContent,
  extensions: Extensions,
  options: DiagnoseRoundtripOptions = {},
): RoundtripDiagnosis {
  const first = load(json, extensions);
  let unsupported = getContentReport(first)?.unsupported ?? [];
  let output: JSONContent;
  try {
    if (options.via === 'html') {
      const html = first.getHTML();
      const second = load(html, extensions);
      try {
        output = getLosslessJSON(second);
        unsupported = [...unsupported, ...(getContentReport(second)?.unsupported ?? [])];
      } finally {
        second.destroy();
      }
    } else {
      output = getLosslessJSON(first);
    }
  } finally {
    first.destroy();
  }
  const diffs = diffStructure(json, output);
  return { lossless: diffs.length === 0, diffs, unsupported, output };
}

/** One line per diff (for logs and assertion messages). */
export function formatRoundtripDiffs(diffs: RoundtripDiff[], limit = 30): string {
  const lines = diffs
    .slice(0, limit)
    .map((d) => `  ${d.kind} ${d.path}: ${JSON.stringify(d.before)} → ${JSON.stringify(d.after)}`);
  if (diffs.length > limit) lines.push(`  … ${diffs.length - limit} more`);
  return lines.join('\n');
}
