import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Plain consumer config: no aliases — @rchemist/editor resolves from node_modules (npm pack tarball).
export default defineConfig({ plugins: [react()] });
