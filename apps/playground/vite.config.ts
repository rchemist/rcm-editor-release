import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { tiptapVersionDefine } from '../../scripts/tiptap-version.mjs';

const src = (p: string) => fileURLToPath(new URL(`../../src/${p}`, import.meta.url));
// 빌드 입력: playground 본체 + (있으면) 붙여넣기 표본 캡처 페이지 + 인쇄 미리보기 페이지.
const page = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  define: tiptapVersionDefine(),
  resolve: {
    alias: [
      { find: /^@rchemist\/editor\/react$/, replacement: src('react/index.ts') },
      { find: /^@rchemist\/editor\/upload$/, replacement: src('upload/index.ts') },
      { find: /^@rchemist\/editor\/docparser$/, replacement: src('docparser/index.ts') },
      { find: /^@rchemist\/editor\/print$/, replacement: src('print/index.ts') },
      { find: /^@rchemist\/editor$/, replacement: src('index.ts') },
    ],
  },
  server: { port: 5173, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        index: page('index.html'),
        ...(existsSync(page('capture.html')) ? { capture: page('capture.html') } : {}),
        print: page('print.html'),
      },
    },
  },
});
