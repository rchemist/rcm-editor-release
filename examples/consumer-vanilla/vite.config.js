import { defineConfig } from 'vite';

// Plain consumer config: no plugins, no aliases — @rchemist/editor resolves from node_modules
// (npm pack tarball). No React plugin either: the consumer ships no React code.
export default defineConfig({});
