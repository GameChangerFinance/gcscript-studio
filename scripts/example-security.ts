import type { Plugin, PreviewServer, ViteDevServer } from 'vite';

/** Restrict the gallery document, while leaving the IDE itself embeddable. Static host equivalents accompany it. */
export function exampleSecurity(): Plugin {
  const configure = (server: ViteDevServer | PreviewServer): void => {
    server.middlewares.use((request, response, next) => {
      if (
        request.url?.split('?')[0] ===
        server.config.base + 'examples/gcscript-studio-three-ides.html'
      ) {
        response.setHeader('X-Frame-Options', 'DENY');
        response.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
      }
      next();
    });
  };
  return {
    name: 'studio-example-security',
    configureServer: configure,
    configurePreviewServer: configure,
  };
}
