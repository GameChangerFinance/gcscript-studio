# Workflow contracts

## Import and export

All file pickers, explorer drops, saved project JSON and hosted examples enter the
controller's import flow. Read and validate the complete payload before committing.
A single file offers adding to the current project or opening a new one. Replacement
projects require Save ZIP / continue without saving / cancel. Existing file conflicts
require an explicit replacement choice. Decisions are bound to the starting project
revision; edits while a dialog or fetch is pending invalidate the import.

GC-encoded `/api/2/edit/` links are decoded and validated before entering this flow.
Normal links retain the same choices. Explicit embedded links replace only the
isolated embedded workspace without prompting; manual imports still use the normal
decisions. Corrupt links and stale async decodes preserve existing work. Link output
encodes source/VFS directly without building it, preserving comments and imports.

Import actions never download files by themselves. A download occurs only for an
explicit save choice or export command. Selected-file export preserves the file's
name, encoding and bytes. Project ZIP/TAR.GZ preserve binary files and empty folders;
project JSON preserves the full serializable VFS. Directory drops drain all reader
batches before importing. No operation writes a host file through an import picker.

## Editing

The shared store records bounded workspace snapshots, coalesces bursts of code typing,
and includes entrypoint changes in filesystem undo/redo. A new project starts a new
history. Undo increases the project revision to invalidate in-flight operations.
Monaco applies changed spans instead of resetting its model. Blockly flushes valid
pending changes before shared undo; disconnected drafts use its native history.

Monaco's API does not register hover, completion, find or quick-fix UI automatically.
`adapters/monaco/features.ts` explicitly loads those contributions. Preserve them when
changing entrypoints. The tooltip preference defaults on and controls Code, Nodes, Blocks and button help. A single contextual Monaco hover provider renders Markdown and uses the same ISL token spans as the highlighter.

The toolbar tooltip button changes the same `codeTooltips` option immediately,
without schema reload. Escape dismisses documentation and control help independently
of focus. Monaco overflow widgets live in a document-level container with Monaco's
theme context so pane clipping does not truncate code help.

## Wallet

`refAddress` is an optional Cardano address for referral programs, as documented by GC 1.2.4. It defaults empty; Studio never inserts its own URL as `ref`.

`walletParameters` is the canonical transport policy for Run, URLs, QR and snippets.
The default router produces `networkTag` from Options. Only `disableNetworkRouter`
omits it. Run builds and encodes first, then opens the final URL directly. A blocked
popup offers a prepared Open wallet link, without a blank/intermediate popup page.
Popup, same-window redirect and QR modes share the same parameters and callback.

Run saves its correlated return callback in the active source before building;
this is visible and undoable. Results merge recursively into existing object exports
by default; incoming arrays/scalars replace their previous values. The checkbox can
select complete replacement instead. Invalid existing JSON is preserved on merge
failure. Own-key traversal prevents prototype mutation. Callback records are bound
to project identity and expire; failures retain results for retry.

## Schemas and validation

Production loads the configured remote schema and `extras.json.full`; there is no
bundled wallet-schema fallback. Test schemas live only under `tests/fixtures/`.
Cache entries contain a timestamp and bundle, expire at exactly 24 hours, and reject
future/malformed/legacy timestamps. This matches `GCScriptSchemaCacheTTLHours = 24`
in the installed official GC 1.2.4 CLI/config. Refresh invalidates both URLs and
prevents older in-flight responses from rewriting refreshed entries.

Validation runs after a configured editing pause and also drains sustained edits
on an interval, with no overlapping background runs. Build with validation disabled
first, then use GC's rich validate report on strict built JSON. Final Build/Run
still validate normally. Background reports do not open or replace the inspector;
the problems button opens them. Stale reports are discarded. Monaco maps JSON
Pointers back to source ranges rather than reusing strict-output offsets in JSONC.
Missing imported ranges fall back to their nearest source ancestor. Quick fixes
use a bounded set of exact GC enum suggestions only while the provided value matches.
