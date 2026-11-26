# Security

Report vulnerabilities privately to the maintainers through the repository's GitHub security reporting channel when enabled. Do not include wallet seeds, private keys, passwords, personal wallet exports, or access tokens in an issue.

Studio executes no wallet script itself. The wallet handles execution and approvals. Imported source, schema descriptions, archive paths and wallet results are untrusted data. Markdown is sanitized, VFS paths are validated, build resources are restricted to `app://`, and asynchronous project operations reject stale snapshots.

Schema and project data are stored in the browser. Schema cache failure does not disable editing; project persistence failure pauses autosave with an explicit message. Wallet returns require an existing, unexpired run record bound to the project identity. Correlation identifiers are not authentication credentials.

Browser tests use disposable fixtures. Never test filesystem overwrite/deletion safety against real host system paths or put sensitive wallet exports in committed fixtures.

Links never execute imported code automatically. The embedded namespace is
workspace separation, not an origin/security boundary. Links may appear in browser
history, host logs and shared documentation; do not publish private project data.

The three-editor gallery restricts iframe navigation to its fixed IDE edit endpoint
and hash-authorizes its small inline bootstrap. Child frames remain dormant when
the gallery is itself nested. Apache, Netlify, Vercel and Vite additionally deny
framing that gallery document with response headers; GitHub Pages relies on the
client guard and cannot provide the same header-enforced anti-framing guarantee.
The embeddable IDE itself deliberately remains frameable. The parent gallery has
no wallet-result handler or executable command bridge.

## Bundled dependencies

The installed dependency graph is pinned and checked with `pnpm audit`. Package overrides apply to installed packages; they do not rewrite prebuilt browser bundles. Review those artifacts separately when updating dependencies. Studio restricts build resources to its virtual `app://` filesystem. A clean package audit does not certify bundled code.

## URL and payload imports

Use direct HTTP(S) URLs on hosts you trust. Remote imports require CORS access;
Studio omits credentials and referrer data and refuses redirects. Size and timeout
limits reject oversized downloads. Project imports also cap file/directory counts
(default: 5,000 entries), while compressed imports check actual gzip and
ZIP/TAR.GZ expansion before opening project contents. ZIP64, split and encrypted
ZIP archives are unsupported. Imported HTML, SVG and script text is never mounted
as executable content. Opening source does not build it or launch the wallet.

Import validation and save choices preserve the current project on errors or
cancellation. GCScript can contain remote resource references; review imported
source before explicitly building or running it.
