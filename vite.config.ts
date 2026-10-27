import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { blocklyAssets } from './scripts/blockly-assets.ts';
import { exampleSecurity } from './scripts/example-security.ts';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), blocklyAssets(), exampleSecurity()],
  build: { sourcemap: true },
});
