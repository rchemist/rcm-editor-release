import { defineConfig } from 'tsup';
import type { Options } from 'tsup';
import { tiptapVersionDefine } from './scripts/tiptap-version.mjs';

const shared: Options = {
  format: ['esm', 'cjs'],
  splitting: true,
  dts: true,
  sourcemap: true,
  // `npm run build` cleans dist once; per-config clean would race between the two builds.
  clean: false,
  outDir: 'dist',
  define: tiptapVersionDefine(),
  esbuildOptions(options) {
    options.sourcesContent = false;
  },
  // CodeMirror stays a real dynamic `import()`: consumer bundlers split the chunk
  // instead of `dist/react.js` carrying it.
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    /^@tiptap\//,
    /^@codemirror\//,
    /^@lezer\//,
    '@rchemist/listgrid',
  ],
};

export default defineConfig([
  // Framework-agnostic entries: no React, no client directive (usable from RSC / Node).
  {
    ...shared,
    entry: {
      index: 'src/index.ts',
      upload: 'src/upload/index.ts',
      paste: 'src/paste/index.ts',
      print: 'src/print/index.ts',
      docparser: 'src/docparser/index.ts',
    },
  },
  // React entries: esbuild drops module directives, so re-add `"use client"` as a banner.
  // Built separately so no shared chunk mixes client code into the core entries.
  {
    ...shared,
    entry: { react: 'src/react/index.ts' },
    // Single entry needs no chunks; splitting would make tsup prepend "use strict" to CJS
    // ahead of the banner, which demotes "use client" out of the directive prologue.
    splitting: false,
    banner: { js: '"use client";' },
  },
  // Vanilla mount: bundles the React component, renders it with react-dom/client.
  {
    ...shared,
    entry: { vanilla: 'src/vanilla/index.ts' },
    splitting: false,
  },
  // listgrid adapter: a client component importing `RcmEditor` from
  // `@rchemist/editor/react`, so that subpath stays external (no second RcmEditor copy).
  {
    ...shared,
    entry: { listgrid: 'src/listgrid/index.ts' },
    splitting: false,
    banner: { js: '"use client";' },
    external: [...(shared.external ?? []), '@rchemist/editor', '@rchemist/editor/react'],
  },
]);
