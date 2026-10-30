import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

/** Load a second, independent module instance of a package entry (simulates a duplicated install). */
export async function loadDuplicate<T>(specifier: string): Promise<T> {
  const url = `${pathToFileURL(require.resolve(specifier)).href}?duplicate`;
  return (await import(/* @vite-ignore */ url)) as T;
}
