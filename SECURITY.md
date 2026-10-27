# Security

Report vulnerabilities privately to the maintainers through the repository's GitHub security reporting channel when enabled. Do not include wallet seeds, private keys, passwords, personal wallet exports, or access tokens in an issue.

Studio executes no wallet script itself. The wallet handles execution and approvals. Imported source, schema descriptions, archive paths and wallet results are untrusted data. Markdown is sanitized, VFS paths are validated, build resources are restricted to `app://`, and asynchronous project operations reject stale snapshots.

Schema and project data are stored in the browser. Schema cache failure does not disable editing; project persistence failure pauses autosave with an explicit message. Wallet returns require an existing, unexpired run record bound to the project identity. Correlation identifiers are not authentication credentials.

Browser tests use disposable fixtures. Never test filesystem overwrite/deletion safety against real host system paths or put sensitive wallet exports in committed fixtures.

Editor links use GC's compressed message decoder and then validate sizes, project
versions, VFS paths and file representations before changing state. Decoded-size
checks occur after GC decompression; they do not provide streaming decompression
limits. Links never execute imported code automatically. The embedded namespace is
workspace separation, not an origin/security boundary. Links may appear in browser
history, host logs and shared documentation; do not publish private project data.

## Bundled dependencies

The installed dependency graph is pinned and checked with `pnpm audit`. Targeted overrides replace upstream-pinned DOMPurify and fast-uri packages with patched releases. The official GC package also ships a prebuilt browser runtime containing bundled dependencies; package overrides do not rewrite that artifact. Upstream vendored fixes require an updated GC browser release. Studio restricts build resources to its virtual `app://` filesystem. A clean package audit does not certify vendored code.
