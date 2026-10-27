import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import type { Plugin } from 'vite';
/** Serve and emit the same package-owned Blockly media in development and production. */
export function blocklyAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const directory = join(dirname(require.resolve('blockly/core')), 'media');
  const names = readdirSync(directory).filter((name) => !name.endsWith('.mp3'));
  return {
    name: 'studio-blockly-media',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? '',
          prefix = server.config.base + 'blockly-media/';
        if (!path.startsWith(prefix)) return next();
        const name = path.slice(prefix.length);
        if (!names.includes(name)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader(
          'Content-Type',
          name.endsWith('.svg')
            ? 'image/svg+xml'
            : name.endsWith('.png')
              ? 'image/png'
              : 'application/octet-stream',
        );
        res.end(readFileSync(join(directory, name)));
      });
    },
    generateBundle() {
      for (const name of names)
        this.emitFile({
          type: 'asset',
          fileName: 'blockly-media/' + name,
          source: readFileSync(join(directory, name)),
        });
    },
  };
}
