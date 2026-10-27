# Branding and discovery

The canonical public app is `https://gamechangerfinance.github.io/gcscript-studio/`.
`index.html` supplies its search description, canonical URL, Open Graph and
Twitter cards, and Schema.org SoftwareApplication data without requiring JavaScript.
The app header and favicon share `public/branding/logo.svg`, a connected-node mark.

## Repository description

Browser IDE for GCScript DSL and ISL for building in Cardano and other ecosystems: code, nodes, blocks, 100+ examples, multi-file builds, HTML+JS, React, Express dapp code generation. Run code in GameChanger Wallet or your wallet of choice. Edit and build locally. Embed and integrate with ease with iframes and links. No dependencies required.

Suggested GitHub topics (20):

```text
gcscript gamechanger gamechanger-wallet cardano isl browser-ide visual-programming
low-code monaco-editor blockly retejs jsonc schema-driven developer-tools
dapp-development wallet-integration local-first typescript vite embeddable
```

These are proposed repository settings; editing this file does not update GitHub.
GitHub's social preview is also a separate repository setting: upload
`public/branding/readme-hero.png` under Settings → General → Social preview.
HTML social tags apply to the hosted app, not the GitHub repository page.

## Asset sources

- `assets/branding/editor-screenshot.png`: supplied Studio screenshot, unchanged.
- `public/branding/logo.svg`: editable vector source used by the app and favicon.
- `scripts/prepare-branding.mjs`: code-based layout for the shared 1600×840
  README hero/social image and PNG icon fallbacks. The screenshot remains intact
  inside the layout. This uses the existing Playwright dependency solely to
  render images, and does not run tests.

Regenerate explicitly with the installed Playwright Chromium:

```sh
pnpm branding:prepare
```

Or select an installed Chrome executable:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome pnpm branding:prepare
```

Commit generated images alongside source changes after review. Asset generation
does not run during normal dev, build or test commands and needs no external
network requests. If the public deployment changes, update the absolute URLs in
`index.html`, `public/robots.txt` and `public/sitemap.xml` together; icon paths use
Vite's deployment base. At a subpath, `robots.txt` is informative only: crawlers
discover robot rules at the origin root, which this project cannot control on
shared GitHub Pages hosting.

Keep descriptions factual and useful; keywords and topics describe implemented
features. There are no hidden keyword lists, fabricated ratings or agent-specific
ranking claims.
