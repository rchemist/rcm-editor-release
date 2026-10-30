import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import { DEFAULT_EDITOR_LABELS, RcmEditor } from '@rchemist/editor/react';
import type {
  RcmEditorLabels,
  RcmFontOption,
  RcmToolbarConfig,
  RcmToolbarPreset,
} from '@rchemist/editor/react';
import type { ContentReport } from '@rchemist/editor';
import { playgroundAssets } from './fixtureAssets';
import { onUploadError, uploadFile, uploadImage } from './uploadModes';

export interface EditorHostProps {
  onEditor: (editor: Editor | null) => void;
  onUpdate: (editor: Editor) => void;
  onContentReport?: (report: ContentReport) => void;
}

const editorProps = { attributes: { 'data-testid': 'editor-content' } };
// ?assets=flaky: every resolveAsset call returns a fresh "signed" URL (e2e re-resolution test).
const flakyCalls: string[] = [];
const flakyAsset = (src: string): string => {
  flakyCalls.push(src);
  return `/__asset/${flakyCalls.length}.png`;
};
if (new URLSearchParams(window.location.search).get('assets') === 'flaky') {
  (window as unknown as { __rcmFlakyCalls: string[] }).__rcmFlakyCalls = flakyCalls;
}
const features = {
  image: {
    resolveAsset:
      new URLSearchParams(window.location.search).get('assets') === 'flaky'
        ? flakyAsset
        : playgroundAssets,
  },
};

// e2e switches: ?toolbar=simple|full|none, ?toolbarOverflow=wrap, ?labels=sentinel, ?fonts=custom
const query = new URLSearchParams(window.location.search);
const toolbarParam = query.get('toolbar');
const toolbarPreset: RcmToolbarPreset | false | undefined =
  toolbarParam === 'none'
    ? false
    : toolbarParam === 'simple' || toolbarParam === 'full'
      ? toolbarParam
      : undefined;
const toolbar: RcmToolbarPreset | RcmToolbarConfig | false | undefined =
  query.get('toolbarOverflow') === 'wrap' && toolbarPreset !== false
    ? { preset: toolbarPreset ?? 'full', overflow: 'wrap' }
    : toolbarPreset;
const tableMenu = query.get('tableMenu') !== '0';
// e2e switch: ?findShortcut=0 turns the Mod-F interception off
const findShortcut = query.get('findShortcut') !== '0';
// e2e switch: ?sourceMode=0 hides the toolbar `source` toggle
const sourceMode = query.get('sourceMode') !== '0';
// e2e/manual switch: ?htmlPolicy=trusted keeps every input verbatim (sandboxed previews)
const htmlPolicyParam = query.get('htmlPolicy');
const htmlPolicy = htmlPolicyParam === 'trusted' ? 'trusted' : undefined;
const labels: Partial<RcmEditorLabels> | undefined =
  query.get('labels') === 'sentinel'
    ? (Object.fromEntries(
        Object.keys(DEFAULT_EDITOR_LABELS).map((k) => [k, `SENTINEL_${k}`]),
      ) as Partial<RcmEditorLabels>)
    : undefined;
const customFonts: RcmFontOption[] | undefined =
  query.get('fonts') === 'custom'
    ? [
        { label: 'Alpha', value: "'Alpha Test', serif" },
        { label: 'Beta', value: "'Beta Test', monospace" },
      ]
    : undefined;

// e2e/manual switch: ?image=demo loads a block image, a figure and an inline image
// (offline SVG data URLs with real dimensions, so resize math works without network).
const demoSvg = (label: string, w: number, h: number): string =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<rect width="100%" height="100%" fill="#dbeafe"/>` +
      `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" ` +
      `font-family="sans-serif" font-size="20" fill="#1e40af">${label}</text></svg>`,
  )}`;
const demoValue =
  `<p>앞 <img src="${demoSvg('inline', 120, 60)}" alt="인라인 이미지"> 뒤</p>` +
  `<img src="${demoSvg('block', 320, 180)}" alt="블록 이미지" width="320" height="180">` +
  `<figure><img src="${demoSvg('figure', 320, 180)}" alt="그림">` +
  `<figcaption>그림 캡션</figcaption></figure><p></p>`;
const defaultValue = query.get('image') === 'demo' ? demoValue : '<p></p>';

// e2e/manual switch: ?html=raw loads a document with non-round-tripping blocks —
// a classed wrapper div, a <style> block and a <script> (the sandbox/preview isolation marker).
// Under the default `sanitize` policy the script is removed and reported; `?htmlPolicy=trusted`
// keeps everything verbatim behind sandboxed iframe previews.
const rawDemoValue =
  '<p>원문 보존 데모 문단</p>' +
  '<div class="kept"><p>래퍼 div 안 문단</p></div>' +
  '<style>.kept { color: red; }</style>' +
  '<script>try{parent.__rcmPwned=true}catch(e){}</script>';
const initialValue = query.get('html') === 'raw' ? rawDemoValue : defaultValue;

// e2e switch: ?controlled=echo runs the editor controlled —
// every onChange payload is echoed back as `value`, like a host that stores
// and re-renders. Tests push a foreign value via window.__rcmHostSetValue.
const controlledEcho = query.get('controlled') === 'echo';

export function EditorHost({ onEditor, onUpdate, onContentReport }: EditorHostProps) {
  const editorRef = useRef<Editor | null>(null);
  const [hostValue, setHostValue] = useState<string | JSONContent | null>(null);

  useEffect(() => () => onEditor(null), [onEditor]);

  useEffect(() => {
    if (!controlledEcho) return;
    const w = window as unknown as { __rcmHostSetValue?: (v: string | JSONContent) => void };
    w.__rcmHostSetValue = (v) => setHostValue(v);
    return () => {
      delete w.__rcmHostSetValue;
    };
  }, []);

  return (
    <RcmEditor
      value={controlledEcho ? (hostValue ?? initialValue) : undefined}
      defaultValue={controlledEcho ? undefined : initialValue}
      minHeight={240}
      toolbar={toolbar}
      findShortcut={findShortcut}
      tableMenu={tableMenu}
      sourceMode={sourceMode}
      htmlPolicy={htmlPolicy}
      labels={labels}
      fonts={customFonts}
      uploadImage={uploadImage}
      uploadFile={uploadFile}
      onUploadError={onUploadError}
      editorProps={editorProps}
      features={features}
      onContentReport={(report) => onContentReport?.(report)}
      onReady={(e) => {
        editorRef.current = e;
        onEditor(e);
        onUpdate(e);
      }}
      onChange={(change) => {
        if (controlledEcho) setHostValue(change.html);
        if (editorRef.current) onUpdate(editorRef.current);
      }}
    />
  );
}
