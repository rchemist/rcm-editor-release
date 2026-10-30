import { Extension, Mark, Node as TiptapNode } from '@tiptap/core';
import type { Editor, Extensions } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';

/** Replaced at build/test time (scripts/tiptap-version.mjs). */
declare const __RCM_TIPTAP_VERSION__: string;

/** The `@tiptap/core` version this package was built and tested against. */
export const TIPTAP_VERSION: string = __RCM_TIPTAP_VERSION__;

/** Stable code prefixed to the duplicate-install warning. */
export const TIPTAP_DUPLICATE_CODE = 'RCM_EDITOR_TIPTAP_DUPLICATE';

export interface TiptapDuplicateFinding {
  /** `extension`: not created by our `@tiptap/core`; `plugin`: not created by our `@tiptap/pm`. */
  kind: 'extension' | 'plugin';
  name: string;
}

type Named = { name?: unknown; key?: unknown };

function isEditor(target: Editor | Extensions): target is Editor {
  return !Array.isArray(target);
}

function isOurExtension(ext: unknown): boolean {
  return ext instanceof Extension || ext instanceof TiptapNode || ext instanceof Mark;
}

function extensionFindings(list: readonly unknown[]): TiptapDuplicateFinding[] {
  return list
    .filter((ext) => !isOurExtension(ext))
    .map((ext) => ({ kind: 'extension', name: String((ext as Named)?.name ?? 'unknown') }));
}

/**
 * Find extensions/plugins that come from a different `@tiptap/core` / `@tiptap/pm` install than
 * the one this package resolves (a version drift that duplicated tiptap in node_modules).
 * Accepts an extension list (before creating an editor) or a live editor (flattened extensions
 * and every ProseMirror plugin in its state). Returns `[]` when everything shares one install.
 */
export function detectTiptapDuplicates(target: Editor | Extensions): TiptapDuplicateFinding[] {
  if (!isEditor(target)) return extensionFindings(target);
  const plugins: TiptapDuplicateFinding[] = target.state.plugins
    .filter((p) => !(p instanceof Plugin))
    .map((p) => ({ kind: 'plugin', name: String((p as unknown as Named).key ?? 'plugin') }));
  return [...extensionFindings(target.extensionManager.extensions), ...plugins];
}

/** Human-readable warning (with fix hint) for a non-empty finding list. */
export function formatTiptapDuplicateWarning(findings: readonly TiptapDuplicateFinding[]): string {
  const shown = findings
    .slice(0, 5)
    .map((f) => `${f.kind} "${f.name}"`)
    .join(', ');
  const more = findings.length > 5 ? ` (+${findings.length - 5} more)` : '';
  return (
    `[${TIPTAP_DUPLICATE_CODE}] Found ${shown}${more} from a different @tiptap/core or ` +
    `@tiptap/pm install than the one @rchemist/editor uses. tiptap packages must share one ` +
    `exact version: align ` +
    `every @tiptap/* dependency to ${TIPTAP_VERSION} (check with \`npm ls @tiptap/pm\`) or force ` +
    `it with npm "overrides" / pnpm "pnpm.overrides" / yarn "resolutions".`
  );
}
