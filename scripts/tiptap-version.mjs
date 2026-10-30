// Build-time source of TIPTAP_VERSION: the installed @tiptap/core we build against, which must
// equal the exact devDependency pin (lockstep guard). Used by tsup, vitest and the playground.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

export function tiptapVersion() {
  const pinned = read('package.json').devDependencies['@tiptap/core'];
  const installed = read('node_modules/@tiptap/core/package.json').version;
  if (pinned !== installed) {
    throw new Error(
      `@tiptap/core devDependency pin ${pinned} != installed ${installed}; run npm install`,
    );
  }
  return installed;
}

export const tiptapVersionDefine = () => ({
  __RCM_TIPTAP_VERSION__: JSON.stringify(tiptapVersion()),
});
