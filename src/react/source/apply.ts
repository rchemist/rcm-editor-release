// Composition of the core for the React source mode: the in-source `onChange`
// payload and the raw-fragment apply/convert actions. The core functions are the single
// source of truth — nothing here re-implements policy or preservation.
import { elementFromString } from '@tiptap/core';
import type { Editor, JSONContent } from '@tiptap/core';
import { DOMParser as ProseMirrorParser, Fragment } from '@tiptap/pm/model';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { RAW_HTML } from '../../extensions/rawHtml';
import { preserveHtmlForLoad } from '../../html/preserve';
import type { PolicyRemovedEntry, RawHtmlEntry } from '../../index';
import type { HtmlPolicy } from '../../index';
import { unwrapUnsupported } from '../../guard/guard';

/** The editor's HTML policy inputs (`htmlPolicyOf` reads them from the guard options). */
export interface PolicyInputs {
  policy?: HtmlPolicy;
  iframeHosts?: string[];
}

/** Parses `html` into a schema document node (fragments live in a wrapper body element). */
function parseHtml(html: string, schema: Schema): PMNode | null {
  try {
    return ProseMirrorParser.fromSchema(schema).parse(elementFromString(html));
  } catch {
    return null;
  }
}

/**
 * The source-mode `onChange` payload (contract: 소스 모드): `html` is the current source with
 * the policy applied, `json` is its parse — through the same preservation as an apply, so
 * non-round-tripping blocks appear as `rawHtml` nodes instead of vanishing.
 */
export function sourcePreviewPayload(
  schema: Schema,
  text: string,
  inputs: PolicyInputs,
): { html: string; json: JSONContent } {
  const preserved = preserveHtmlForLoad(text, schema, { ...inputs, source: 'setContent' });
  const doc = parseHtml(preserved.html, schema) ?? schema.topNodeType.createAndFill();
  return {
    html: preserved.policyHtml,
    json: unwrapUnsupported((doc ?? schema.topNodeType.create(null)).toJSON() as JSONContent),
  };
}

export interface FragmentApplyResult {
  rawHtml: RawHtmlEntry[];
  policyRemoved: PolicyRemovedEntry[];
}

/**
 * Replaces the `rawHtml` node at `pos` with the fragment source `html` (raw node view):
 * `'apply'` re-runs the preservation for the fragment — a fragment that now round-trips
 * becomes normal blocks, one that still does not stays `rawHtml`; `'convert'` parses the
 * policy output directly, accepting the loss (the lost parts are reported for the notice).
 * Either way one transaction: a single undo step.
 */
export function applyFragmentToEditor(
  editor: Editor,
  pos: number,
  html: string,
  mode: 'apply' | 'convert',
  inputs: PolicyInputs,
): FragmentApplyResult | null {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== RAW_HTML) return null;
  const preserved = preserveHtmlForLoad(html, editor.schema, {
    ...inputs,
    source: 'insertContent',
  });
  const parsed = parseHtml(mode === 'apply' ? preserved.html : preserved.policyHtml, editor.schema);
  if (!parsed) return null;
  const paragraph = editor.schema.nodes.paragraph;
  const content: Fragment =
    parsed.childCount > 0
      ? parsed.content
      : paragraph
        ? Fragment.fromArray([paragraph.create()])
        : Fragment.empty;
  try {
    editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + node.nodeSize, content));
  } catch {
    return null;
  }
  return { rawHtml: preserved.rawHtml, policyRemoved: preserved.policyRemoved };
}
