# 06: Create Garden and the Sample Garden

**What to build:** A person chooses Create Garden, selects an empty folder, and Research Garden materializes a real Sample Garden into it as actual files on their disk — not a browser-only demo. The Tree grows from what was written. The Sample Garden contains a genuine contradiction between two supported Claim Leaves, so the defining workflow is demonstrable from a standing start.

**Blocked by:** 04

**Status:** resolved

- [x] Create Garden requires the person to select a local folder
- [x] Create Garden refuses a folder that already contains conflicting content, without overwriting anything
- [x] Create Garden materializes real Sample Garden files into the selected folder
- [x] The materialized Sample Garden validates against the full schema and all graph invariants
- [x] The Sample Garden contains at least two supported Claim Leaves with an explicit Contradicts relationship between them, each backed by its own Root
- [x] The Sample Garden contains at least one Question Leaf that a Harvest could later answer
- [x] The Tree grows from the materialized files immediately after creation
- [ ] Research Garden remembers the Garden Repository's directory handle and display name in browser-local storage, and stores no canonical content there
- [x] A returning person can resume a remembered Garden, and is asked for file permission again whenever the browser requires it

## Inherited from ticket 03

This is the first ticket that writes a file, so it should verify and tick these ticket 03
criteria, which are implemented and unit-tested but have no caller yet:

- [x] Materialized filenames are readable title slugs (`titleSlug`)
- [x] A short identity suffix is appended only to resolve a collision (`fileNameFor`)
- [x] Newly created files use the documented canonical field order (`CANONICAL_FIELD_ORDER`)

## Notes

Verified: `pnpm typecheck` clean, `pnpm test` 750 passing across 24 files, `pnpm build`
succeeds. The shipped bundle was driven in real headless Chromium against a writable fake
folder: Create Garden wrote 8 files with readable slug filenames, the Tree grew 8 nodes
with 1 Contradicts Cross-link and no Diagnostics, and all 8 labels were distinct with 0
overlaps. Pointed at a folder that already held canonical Markdown it refused, listed what
it found, wrote nothing, and "Open this Garden" opened that folder without asking for it a
second time.

### One criterion left unticked

"Research Garden remembers the Garden Repository's directory handle and display name in
browser-local storage" -- the store is a port with a shared contract, and the whole
create-remember-resume path is tested against the in-memory adapter. But
`IndexedDbRememberedGardenStore` itself has no coverage: jsdom has no IndexedDB, and the
browser harness cannot exercise it either, because a fake directory handle carries methods
and is therefore not structured-cloneable. Raw IndexedDB was probed directly in Chromium
and round-trips correctly, so the mechanism works; the adapter's own code does not.

Verifying it needs a real `FileSystemDirectoryHandle` from a real folder pick, which is
ADR 0064's manual acceptance run. Ticket 25 has been annotated.

### Bugs the review caught

- **A PDF in `roots/` blocked creation.** The conflict check never filtered to `.md`,
  contradicting this file's own docstring. Only canonical Markdown and the operational
  directory conflict now.
- **"Open this Garden" reopened the folder picker**, making the person choose the folder
  they had just chosen. The test concealed it by always returning the same handle; there
  is now a test that counts folder picks.
- **A folder that had been moved or deleted opened as an empty Garden.** Every typed
  directory reported as merely absent, so a person's research appeared to have quietly
  emptied itself. The adapter now confirms the repository is reachable before reporting a
  directory as absent, and says the folder could not be found.
- **A folder was remembered even when nothing opened**, so a refused create still produced
  a "Resume" button. Remembering now waits for a Garden to actually open.
- **`created_at` and `updated_at` read the clock twice**, so a brand-new item could
  straddle a tick (ADR 0077).
- **A literal NUL byte** in `gardenRevision.ts`, introduced back in ticket 02, made git
  treat that file as binary. Replaced with a readable separator.

### Verification added rather than assumed

Create Garden now rereads what it wrote and refuses to call it created if the Garden comes
back with Diagnostics (ADR 0055's reread-and-validate; the snapshot and hash confirmation
belong to ticket 12). That check immediately caught a degenerate test fixture whose
entropy gave all eight items the same id.

The browser filesystem offers no transaction, so a write interrupted partway leaves a
part-written Garden. That is now reported as such -- naming how many files were written
and pointing at Open Garden -- rather than as a bare failure.

### Scope note

`forgetRemembered` and its "Forget it" control were not asked for by any criterion. They
exist because a remembered folder that has gone would otherwise leave a person with a
Resume button that can only fail.
