# Contributing

Use Node.js 24.12+ and the pnpm version pinned in `package.json`.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm exec playwright install chromium
pnpm test:e2e
pnpm format:check
```

`pnpm check` runs strict typechecking, lint, coverage-gated unit/integration tests, and the production build. Playwright browser tests run locally only and are not part of GitHub Actions checks or Pages deployment. They exercise the real local editor bundles, the GC builder, visual adapters, cache refresh, popup return bridge, and responsive dialogs. They use a local schema fixture and an intercepted wallet endpoint; they do not sign or submit transactions.

The core has enforced coverage thresholds. Changes to a shared module should include tests of observable contracts, relevant failure/retry paths, and real consumers. Do not replace meaningful assertions with snapshots of implementation details. Exercise both source authoring and built strict JSON when changing schema or build behavior.

Keep core modules framework-neutral. Put browser APIs, storage, workers, popup lifecycle and downloads in adapters. Views consume normalized data and the shared store. Configuration and semantic colors belong in `src/config.ts`; callers await `getConfig()`.

For changes to GCScript behavior, consult the official `gcscript-dsl` skill and current schemas. Preserve strings for blockchain quantities; do not add numerical coercion. New authoring extensions must declare input/return contracts in `public/extras.json.full`; they must not weaken runtime validation or mutate wallet schemas.

Review [architecture](docs/architecture.md) before moving module boundaries. Apply Prettier to touched files. Keep semantic commit subjects concise, for example `feat(schema): add authoring extension contracts`.

## Release preparation

Update `package.json` and the [changelog](CHANGELOG.md) together. The next release
is `0.2.0`; replace its Unreleased marker with the publication date when releasing.
Run the release checks in [verification](docs/verification.md), including a
production preview under the deployment subpath.

`StudioConfig.version` identifies the saved workspace/project format. Keep it at
`0.1.0` for compatible releases so existing projects and browser sessions continue
to open. Change it only when the persisted format is incompatible.
