# Changelog

## 0.2.0 — Unreleased

### Added

- Fullscreen control with an exit toggle, including permitted iframe embeds.
- Embedded editor button to open the entire current project in a full IDE tab.
- Import fields for HTTP(S) file/archive URLs, GC edit/run links, compressed GC
  payloads and pasted script/project JSON.
- Labeled Output sections highlighting 1-click HTML + JavaScript, React, Button
  and Express dapp generation.
- Footer network selector shared with Options, Run and generated outputs. Labels
  include the DLT name on desktop and omit that prefix on mobile; testnets use
  an amber accent without an error indicator.

### Changed

- Blocks automatically scales and centers after its first render. Fit blocks
  restores the view on demand, including in compact embeds.
- Generated dapp downloads use `*-dapp` filenames instead of `*-snippet`.
- Imports enforce download, expanded-size, archive structure and entry-name
  validation. Remote files require CORS access and are fetched without credentials,
  redirects or referrer information. Imported projects are limited to 5,000
  file/directory entries by default.

### Compatibility

- Existing workspace and project format version `0.1.0` remains supported.
- The embedding page must grant `allow="fullscreen"` for native fullscreen.
  No parent-side wallet handler is required.
- ZIP imports support stored and deflate entries. Encrypted, split and ZIP64
  archives are rejected with an error; current work is preserved.

## 0.1.0

- Initial TypeScript/Vite IDE with Code, Nodes, Blocks and Split views, shared
  schema tools, multi-file builds, wallet runs, project archives and edit links.
- Isolated embedded workspaces, wallet callback capture and documentation gallery.
