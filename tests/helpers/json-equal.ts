// Thin test wrapper over the core normalisation (src/diagnostics/normalize.ts).
import { diffDocs } from '../../src/diagnostics/normalize';
import type { JsonDifference } from '../../src/diagnostics/normalize';

export { diffDocs, normalizeDoc, stableStringify } from '../../src/diagnostics/normalize';
export type { JsonDifference } from '../../src/diagnostics/normalize';

/** Human-readable report of `diffDocs` output (for assertion messages). */
export function formatDifferences(diffs: JsonDifference[], limit = 20): string {
  const lines = diffs
    .slice(0, limit)
    .map(
      (d) => `  ${d.path}: expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.actual)}`,
    );
  if (diffs.length > limit) lines.push(`  … ${diffs.length - limit} more`);
  return lines.join('\n');
}

/** Asserts normalised equality, failing with the list of differing paths. */
export function expectJsonEqual(actual: unknown, expected: unknown): void {
  const diffs = diffDocs(expected, actual);
  if (diffs.length)
    throw new Error(`JSON differs at ${diffs.length} path(s):\n${formatDifferences(diffs)}`);
}
