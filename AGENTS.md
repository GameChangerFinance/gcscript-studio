# Working on GCScript Studio

Read only what the change needs: [architecture](docs/architecture.md),
[workflows and safety](docs/workflows.md), [contributing](CONTRIBUTING.md),
[verification](docs/verification.md), [deployment](docs/deployment.md), and
[security](SECURITY.md). End-user behavior is documented in [README](README.md).

## Rules

- Inspect current code and call sites before editing. Preserve working features and
  Options controls; migration does not authorize dropping behavior.
- Use the `web-app` and `gcscript-dsl` skills for their respective layers. Derive
  language behavior, categories and suggestions from official schemas/GC contracts.
- Keep core transformations deterministic and browser/framework independent.
  Centralize policy/defaults/colors/timers in `src/config.ts`; consume it asynchronously.
- Source JSONC and the serializable VFS are authoritative. All views and commands
  share edits and undo/redo. Preserve comments and source order.
- Imports never invoke exports without an explicit save choice. Ask before opening
  a replacement project or overwriting files; cancel and stale operations preserve work.
  Explicit embedded edit links replace only their isolated workspace without prompts.
- Run enforces the Options network by default. Only the explicit router opt-out
  uses the wallet's network. Open the final wallet URL directly; persist the callback.
- Referral attribution defaults empty; only an explicit Options address may set `ref`.
- Keep every control usable, labeled and explained by a tooltip. Menus are exclusive;
  dialogs stay in the viewport. Inspect rendered desktop/mobile behavior.
- Keep validation debounced, bounded and stale-safe. Preserve rich GC diagnostics;
  offer exact, relevant fixes without dumping schema branch noise.
- Treat schemas, archives, paths, markdown and wallet results as untrusted data.
  Never expose secrets, maintainer home paths or executable window bridges.
- Run targeted checks, then shared/bundled/browser checks as appropriate. Report
  actual commands, results and unverified areas; never weaken tests to pass.
