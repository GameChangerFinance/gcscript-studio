# Static deployments

The deployment artifact is `dist/`. `public/` holds source assets copied by Vite; do not edit generated files inside `dist/`.

Search/social metadata uses the official Pages URL. For a different public host,
update the canonical, card and sitemap URLs together as described in
[branding and discovery](branding.md). Favicons follow the configured Vite base.

## Base paths and callbacks

The default Vite base is `/`. Set `VITE_BASE_PATH=/gcscript-studio/` when hosting under that directory. Asset loading, extras loading and wallet callbacks all use this deployment base rather than the current document's directory.

Wallet callback URLs point to `<base>/index.html?result={result}#studioRun=<correlation-id>`. The callback removes result data from history before decoding, validates the pending run, persists the data-only envelope, notifies the same-origin opener, and closes the popup. A lost opener is handled through the storage event. Cross-device QR results need manual import.

Direct wallet launching enforces the Options network through `networkTag` by default. Only the explicit **Disable network router** option omits it. Embedded wallet callbacks carry the session marker inside the correlation fragment (`#studioRun=embed%3A...`), avoiding an extra query separator in wallet-facing source. Bootstrap resolves that marker before reading session storage; capture restores a clean `?embed=true` URL for redirect mode.

## Editor links and iframes

`<base>/api/2/edit/<GC-message>` must serve the SPA shell while preserving the path and `embed`/`view` query parameters. Existing Apache, Netlify, Vercel and Pages SPA fallbacks handle these routes. Asset and schema URLs resolve against the configured Vite base, never the encoded route. A Pages deep link may still carry HTTP 404 while rendering the app.

For documentation embeds, allow the documentation origin in any custom `Content-Security-Policy: frame-ancestors` policy; do not send a conflicting `X-Frame-Options: DENY`/`SAMEORIGIN` header for cross-origin embeds. The embedding page must allow the IDE origin through its `frame-src` policy. If an iframe sandbox is used, it needs script support and browser storage access for the IDE; wallet launches additionally need popup permission. Choose these permissions for your trust model rather than adding a blanket sandbox combination. No parent-window command bridge is exposed.

Verify a real encoded route inside an iframe at the deployment base. Code, Nodes and Blocks initialize from `view=code|node|block`. `embed=true` starts with collapsed side panels and separate project/options/run/result storage. Schema caches remain shared. See [link formats and examples](../README.md#open-in-ide-links-and-embedded-editors).

The hosted `examples/gcscript-studio-three-ides.html` gallery has a separate policy:
its meta CSP allows only its known IDE edit endpoint, and its bootstrap refuses to
activate child frames when nested. Vite development/preview, Apache (`mod_headers`),
Netlify (`_headers`) and Vercel additionally send `frame-ancestors 'none'` and
`X-Frame-Options: DENY` for that HTML file only. GitHub Pages does not apply these
custom headers; its protection against recursive gallery loading is the client
guard. [A meta tag cannot enforce `frame-ancestors`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors). Update path-specific host rules
for custom subdirectory hosts. These restrictions must never be applied globally to
the embeddable IDE. Keep the bootstrap CSP hash in sync when changing the HTML script.

## GitHub Pages

The Pages workflow runs on pushes to `main` and manual dispatch. It installs locked dependencies, runs checks and browser tests, builds with `/${repository-name}/`, copies a fallback shell to `404.html`, uploads the Pages artifact and deploys it. The repository must enable GitHub Actions as its Pages source. GitHub Pages may return HTTP 404 for an unknown route even when displaying the copied SPA shell; wallet callbacks use the real `index.html` and return HTTP 200.

## Apache

Deploy `dist/`, including its hidden `.htaccess`. Enable `mod_rewrite` and `AllowOverride FileInfo`. The relative `index.html` rewrite works at a domain root or inside a subdirectory. Existing files/directories are served normally. Set the Vite base before building for a subdirectory.

## Netlify and Vercel

The root configuration files install/build the project and publish `dist/`. SPA fallback applies after static files. If you customize a subpath, update the host's routing and `VITE_BASE_PATH` together. Keep callbacks on the same origin and deployment base as the IDE.

## Verification

Check the root, a deep link with a query, the real `index.html` callback, `extras.json.full`, Monaco workers, and `blockly-media/sprites.svg`. Run the browser suite against a production preview using `PLAYWRIGHT_BASE_URL` once the host is deployed. Real wallet execution and host-specific Apache modules/Pages permissions need verification on the destination host.
