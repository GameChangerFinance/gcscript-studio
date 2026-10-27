import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { blocklyAssets } from './scripts/blockly-assets.ts';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), blocklyAssets()],
  build: { sourcemap: true },
});
