# Verification

## Release checks

The complete local release checks pass:

- `pnpm check`: typechecking, lint, all 146 unit/integration tests, coverage gates, production build and the reusable-core consumer check.
- `pnpm test:e2e`: all 34 Chrome browser tests pass, including file/project imports, embedded sessions, wallet return capture and graphical editor history. The gallery tests cover three independent iframe editors, a simulated cross-site wallet round trip, blocked unlisted frame URLs and nested-gallery prevention without response headers.
- Nine focused Chrome workflows cover the production `/gcscript-studio/` build: edit links, isolated embedded storage, responsive iframe geometry, fullscreen enter/exit, full-project new tabs, URL/payload imports, network selection, dapp downloads, gallery guards and simulated wallet returns. Desktop/mobile screenshots are inspected for readability.
- `pnpm format:check`: source and documentation formatting pass.

Measured core/config coverage: **95.34% statements, 88.41% branches, 98.05% functions, 98.27% lines**. This measures the configured core/config scope, not React/editor-adapter coverage.

The wider suite also covers source editing, builds, validation, imports, graphical views, schema refresh, return capture, responsive dialogs, deep links and QR generation. The development-only Blockly harness checks lossless serialization, literal-data context, colors, comments, connected arguments and invalid-source guards; it is intentionally absent from production output.

## Commands

```sh
pnpm check
pnpm format:check
pnpm exec playwright install chromium
pnpm test:e2e
pnpm audit --json
```

For a Pages-style preview:

```sh
VITE_BASE_PATH=/gcscript-studio/ pnpm build
VITE_BASE_PATH=/gcscript-studio/ pnpm preview --port 4173
# In another terminal:
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173/gcscript-studio/ pnpm test:e2e
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an existing Chromium/Chrome installation. Playwright tests run locally only; GitHub Actions neither installs browsers nor runs `pnpm test:e2e`.

For the focused editor checks:

```sh
pnpm test tests/unit/build-wallet.test.ts tests/unit/structure-isl.test.ts tests/integration/gc.test.ts tests/integration/controller.test.ts
pnpm test:e2e followup.spec.ts
pnpm test tests/integration/edit-links.test.ts tests/integration/controller.test.ts tests/unit/build-wallet.test.ts
pnpm test:e2e edit-links.spec.ts
pnpm test tests/integration/import-source.test.ts
pnpm test:e2e release-tools.spec.ts
```

## Remaining external checks

Actual wallet signing/submission is not exercised by browser tests; the wallet endpoint and callback exports are simulated. GitHub Pages permissions/source selection, Apache modules/AllowOverride, and Netlify/Vercel deployment behavior must be verified on the destination host. No remote deployment was performed.

The build emits upstream warnings about a guarded CommonJS variable in GC's prebuilt ESM runtime and large editor chunks. Both development and production browser checks passed. The prebuilt GC runtime's bundled dependencies remain upstream-owned; installed-package overrides do not rewrite that artifact.
