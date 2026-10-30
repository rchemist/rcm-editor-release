// Shared JSON normalisation for round-trip comparison (promoted from tests/helpers/json-equal.ts).
// Pure functions: no tiptap/ProseMirror runtime imports (usable from Playwright specs too).

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

/**
 * Normalises tiptap JSON for comparison, applying only ProseMirror-level equivalences:
 * - null/undefined attribute values, empty `attrs` and empty `marks`/`content` are dropped;
 * - object keys are sorted;
 * - marks are sorted (a PM mark set is a set; its order comes from schema rank, and docparser
 *   renderers do not agree on one order);
 * - adjacent text nodes with identical marks are merged (PM always merges them).
 */
export function normalizeDoc(value: unknown): Json {
  if (Array.isArray(value)) return value.map(normalizeDoc);
  if (value === null || typeof value !== 'object') return (value ?? null) as Json;
  const out: Record<string, Json> = {};
  for (const key of Object.keys(value).sort()) {
    let v = (value as Record<string, unknown>)[key];
    if (v === undefined || v === null) continue;
    if (key === 'attrs' && typeof v === 'object') {
      const attrs = Object.fromEntries(
        Object.entries(v as Record<string, unknown>).filter(
          ([, a]) => a !== null && a !== undefined,
        ),
      );
      if (!Object.keys(attrs).length) continue;
      v = attrs;
    }
    if ((key === 'marks' || key === 'content') && Array.isArray(v) && v.length === 0) continue;
    let n = normalizeDoc(v);
    if (key === 'marks' && Array.isArray(n)) n = sortMarks(n);
    if (key === 'content' && Array.isArray(n)) n = mergeText(n);
    out[key] = n;
  }
  return out;
}

function sortMarks(marks: Json[]): Json[] {
  return [...marks].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

const isText = (n: Json): n is JsonObject =>
  n !== null && typeof n === 'object' && !Array.isArray(n) && n.type === 'text';

function mergeText(content: Json[]): Json[] {
  const out: Json[] = [];
  for (const node of content) {
    const prev = out[out.length - 1];
    if (prev !== undefined && isText(prev) && isText(node)) {
      if (JSON.stringify(prev.marks ?? null) === JSON.stringify(node.marks ?? null)) {
        out[out.length - 1] = { ...prev, text: `${String(prev.text)}${String(node.text)}` };
        continue;
      }
    }
    out.push(node);
  }
  return out;
}

/** `JSON.stringify` with object keys sorted at every level (byte-identity comparison). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort())
    out[key] = sortKeys((value as Record<string, unknown>)[key]);
  return out;
}

export interface JsonDifference {
  /** Path like `content[3](paragraph).attrs.lineHeight`. */
  path: string;
  expected: unknown;
  actual: unknown;
}

/** `(type)` suffix used in paths. */
export function typeLabel(node: unknown): string {
  return node && typeof node === 'object' && 'type' in node
    ? `(${String((node as { type: unknown }).type)})`
    : '';
}

const isObj = (v: Json): v is JsonObject =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

function walk(expected: Json, actual: Json, path: string, out: JsonDifference[]): void {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const n = Math.max(expected.length, actual.length);
    for (let i = 0; i < n; i++) {
      const e = expected[i] ?? null;
      walk(e, actual[i] ?? null, `${path}[${i}]${typeLabel(e ?? actual[i])}`, out);
    }
    return;
  }
  if (isObj(expected) && isObj(actual)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    for (const k of keys) {
      walk(expected[k] ?? null, actual[k] ?? null, path ? `${path}.${k}` : k, out);
    }
    return;
  }
  if (JSON.stringify(expected) !== JSON.stringify(actual)) out.push({ path, expected, actual });
}

/** Every differing leaf path between two docs after normalisation (empty = equal). */
export function diffDocs(expected: unknown, actual: unknown): JsonDifference[] {
  const out: JsonDifference[] = [];
  walk(normalizeDoc(expected), normalizeDoc(actual), '', out);
  return out;
}
