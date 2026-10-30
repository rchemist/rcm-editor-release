import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { tiptapVersionDefine } from './scripts/tiptap-version.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  define: tiptapVersionDefine(),
  resolve: {
    // Exact regexes: a plain '@rchemist/editor' prefix alias would also swallow the
    // '/react' and '/listgrid' subpaths.
    alias: [
      { find: /^@rchemist\/editor\/listgrid$/, replacement: `${root}src/listgrid/index.ts` },
      { find: /^@rchemist\/editor\/react$/, replacement: `${root}src/react/index.ts` },
      { find: /^@rchemist\/editor$/, replacement: `${root}src/index.ts` },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
});
