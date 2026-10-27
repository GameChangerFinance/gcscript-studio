import { defineConfig } from 'vite';
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'lib',
    sourcemap: true,
    lib: { entry: { index: 'src/index.ts', config: 'src/config.ts' }, formats: ['es'] },
    rolldownOptions: { external: ['jsonc-parser'] },
  },
});
