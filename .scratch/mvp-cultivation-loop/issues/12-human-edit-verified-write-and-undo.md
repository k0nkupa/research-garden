# 12: Human edit with verified write, Undo Snapshot, and Activity feed

**What to build:** The first path that changes a person's files. They read an item, choose Edit, get the plain Markdown, and save. Research Garden snapshots the previous content, writes once, rereads what it wrote, revalidates it, and confirms its hash before reporting success — a browser acknowledgement is never treated as completion. They can undo. Their hand-authored frontmatter and untouched prose survive, and the diff stays small. The Garden Activity feed records that it happened without becoming a second copy of their content.

**Blocked by:** 05

**Status:** resolved

- [x] The reading panel offers an explicit Edit mode that presents the plain Markdown
- [x] Saving an edit touches at most one canonical Markdown file
- [x] The previous content is saved as an Undo Snapshot before the file is replaced
- [x] The write sequence is: revalidate permission and target hash, snapshot, write once, reread, revalidate, confirm content hash, then report
- [x] A write that fails hash confirmation is reported as a failure, not a success
- [x] Unknown frontmatter fields, comments, and untouched body text survive the edit
- [x] Changing one known field does not fully normalize the rest of the file
- [x] The item's update timestamp changes and its creation timestamp does not
- [x] Undo restores the exact snapshot, and is permitted only while the current file still matches the applied change's resulting hash
- [x] Undo leaves the resulting file record intact so recovery is itself auditable
- [x] The Garden Activity feed shows action name, time, affected item IDs, and outcome, with no raw bodies
- [x] Actions address items by stable ID; no action accepts an absolute or caller-supplied filesystem path
- [x] Canonical writes resolve only to typed Garden directories and operational writes only to defined operational locations

## Inherited from ticket 04

- [x] Adding or editing knowledge never rewrites a Root, because Supports is serialized on
      the Claim or Harvest (ADR 0020). Structurally true today, but unfalsifiable until a
      write path exists.

## Inherited from ticket 03

This is the first ticket that edits an existing item, so it should verify and tick these
ticket 03 criteria:

- [x] `updated_at` moves only when the canonical item is actually edited, and `created_at`
      never moves (ADR 0077)
- [x] A proposed change to a Root that would rewrite its captured evidence is refused;
      only its metadata is correctable (`rootEvidence.ts`, ADR 0012)

## Inherited from ticket 05

- [x] `ensureMutable` refuses to edit an item carrying a Garden Diagnostic, and the
      interface explains why rather than silently doing nothing (ADR 0052)

## Notes

### What was built

- **Domain seam**: `setBody` added to `gardenDocument.ts`, alongside the existing
  `setFrontmatterField`, so a body-only edit is as surgical as a field-only one --
  neither touches the other's part of the document, and both preserve comments and
  unknown fields through the live `yaml.Document`.
- **Verified write tail**: `verifiedWrite.ts` (`writeAndVerify`) is the one place that
  writes, rereads, reparses, revalidates against the schema, and confirms the content
  hash. Both `editItem` and `undoChange` end their own write through it, so the
  guarantee cannot drift between a save and an Undo.
- **`editItem.ts`**: the human-edit Garden Action. Sequence is exactly
  `ensureMutable` → Root-evidence guard → permission → target-hash revalidation →
  parse → no-op short-circuit → snapshot → write-and-verify → report, matching the
  ticket's ordering. A body identical to what's already on disk is treated as no
  edit at all: nothing is written, `updated_at` does not move, and no Undo Snapshot
  is produced (there is nothing to undo).
- **`undoSnapshot.ts`**: the Undo Snapshot record and its read/write, under
  `.research-garden/undo/<id>.json`. `readUndoSnapshot` validates the parsed JSON's
  shape before trusting it and never lets a `JSON.parse` failure (which can quote
  fragments of the surrounding text) escape as an error.
- **`undoChange.ts`**: restores a snapshot's `previousText` only while the current
  file's hash matches the snapshot's `resultingHash`. Before restoring, it snapshots
  *what it is about to overwrite* (the edited content) exactly as `editItem`
  snapshots before its own write, so Undo's own effect is itself recorded and, in
  principle, itself undoable -- not merely "not yet erased." Also re-validates that
  the snapshot's path resolves to one of `CANONICAL_DIRECTORIES` before writing to
  it, since the path travels through this action as data read back off disk rather
  than as something resolved fresh through the Garden Index.
- **`gardenActivity.ts`**: a pure, session-only log. Entries are built only from
  `describeEditItemFailure`/`describeUndoChangeFailure` (colocated with the result
  types they describe), which are themselves built only from each action's own
  fixed, app-authored messages -- never from a caught error's own `.message`, which
  is where file content could otherwise leak in.
- **UI**: `ItemPanel.tsx` gained Edit mode (a plain-text `<textarea>` seeded with the
  item's body verbatim), Save/Cancel, and an Undo button scoped to whichever item
  was just saved. `GardenActivityFeed.tsx` renders the session log. `Workspace.tsx`
  wires both Garden Actions in, reopens the Garden after a successful write so the
  Tree and index reflect it, and accepts optional `now`/`entropy` for deterministic
  tests rather than reaching for real time and randomness.

### What the review caught, and how it was resolved

Ran `/code-review` with both the Standards and Spec sub-agents on `model: opus`,
diffed against `main`. Real, independently-corroborated findings and fixes:

- **Undo never snapshotted before writing.** ADR 0055/0021 apply to every canonical
  write, including Undo's own. Fixed: `undoChange` now writes a fresh Undo Snapshot
  of the content it is about to overwrite before restoring, and returns that new
  snapshot's id.
- **`undoChange` resolved its write path from an unvalidated JSON record.** Fixed
  two ways: `readUndoSnapshot` now validates the parsed shape (required string
  fields, non-empty string-array `path`) before returning it rather than trusting a
  bare cast, and `undoChange` re-checks the snapshot's path against
  `CANONICAL_DIRECTORIES` before writing to it.
- **A no-op save still moved `updated_at`.** Violated the inherited ticket-03
  criterion literally. Fixed: `editItem` now compares the submitted body against
  what's already on disk and treats an identical body as no edit at all.
- **The Activity feed showed titles in place of item IDs.** The ticket asks for
  "affected item IDs" specifically. Fixed: the feed now always renders the id,
  with the title alongside it when one is known.
- **Raw content could leak into Activity via caught-error messages.** `error.message`
  from an unexpected filesystem or parse failure was being surfaced directly, and a
  parser or `JSON.parse` error can quote fragments of the file it failed on. Fixed:
  both `editItem` and `undoChange` now report a fixed, generic message for any
  unexpected failure; the underlying error is deliberately discarded.
- **`ItemPanel.startEditing` had no error handling** -- a lapsed permission mid-read
  would reject unhandled and Edit would silently do nothing. Fixed: wrapped in
  try/catch with a visible error.
- **Time and entropy were reached for in `Workspace.tsx`** rather than injected,
  breaking the repo's own stated convention (`ulid.ts`) and leaving `EditItemOptions`
  exercised only by unit tests. Fixed: `Workspace` now accepts optional `now`/
  `entropy` props threaded through to both Garden Actions and to Activity entry
  ids/timestamps; a duplicated `new Date().toISOString().replace(...)` timestamp
  formatter (also found copied from `createGarden.ts`) was extracted to
  `canonicalTimestamp.ts` and both call sites now share it. This surfaced a real
  wiring bug in the same fix: `saveEdit` built its Activity entry from the injected
  clock but never actually passed `{ now, entropy }` into `editItem` itself: a new
  integration test (`editAndUndoLoop.test.tsx`, "uses the injected clock and entropy")
  caught this immediately once written.
- **Repeated, hand-written `switch (result.kind)` message maps** in `ItemPanel.tsx`
  and `gardenActivity.ts` for both `EditItemResult` and `UndoChangeResult`. Fixed:
  `describeEditItemFailure`/`describeUndoChangeFailure` are now colocated with
  their result types and are the one place either result becomes a sentence; both
  the Activity feed and the Edit form call them.
- **The "Roots don't take body edits" rule was duplicated** across `rootEvidence.ts`,
  `editItem.ts`, and twice in `ItemPanel.tsx`. Fixed: `isBodyEditableKind` is now
  exported from `rootEvidence.ts` (the module ADR 0012 already assigns this rule to)
  and used by the UI. `editItem.ts` still performs its own literal
  `indexed.item.kind === 'root'` check rather than calling the predicate, because
  TypeScript's discriminated-union narrowing needs the literal comparison in that
  spot to narrow `indexed.item` to `RootItem` for `rootEvidenceChanges`; this is
  noted in a comment there.
- **`ItemPanel`'s `undoAvailable` carried a `snapshotId` that was never read** --
  only its presence was checked. Fixed: simplified to a plain `boolean`.
- **The Activity toggle button reused the `workspace__diagnostics-toggle` CSS
  class**, a name describing behaviour it doesn't have. Fixed: renamed to the
  shared `workspace__panel-toggle`, used by both toggle buttons.
- **`setBody` cloned the YAML document without ever mutating it.** Fixed: it now
  shares the reference; `setFrontmatterField` always clones before it mutates, so
  this cannot let an edit through one function leak into a document reached
  through the other.
- Added a direct test making the inherited ticket-04 criterion actually falsifiable:
  editing a Claim Leaf's body with a live `supported_by` reference to a Root now has
  a test proving the Root's file is never touched and the relationship survives
  unchanged.

### Deviations from a literal reading, with reasons

- **`undoChange` does not call `ensureMutable`.** The ticket-05 criterion is about
  refusing to *edit* an item with a Diagnostic. Undo is a different operation with a
  strictly stronger precondition already (the current file's hash must exactly match
  what the reverted edit produced). Gating Undo on Diagnostics as well would create
  exactly the failure mode the Undo Snapshot exists to prevent: if a hand edit made
  *after* an applied change broke the file, `ensureMutable` would then refuse the one
  action that could recover it. This is a deliberate decision, documented in a
  comment in `undoChange.ts`, not an oversight.
- **Edit mode edits the body only, not frontmatter fields.** The ticket's "plain
  Markdown" and ADR 0041's "plain-text editor" are read as the body -- the same text
  `renderGardenMarkdown` renders for reading -- rather than the raw file including
  YAML frontmatter. Frontmatter fields (title, relations, Root metadata corrections)
  are not exposed for editing in this build; nothing in the ticket's criteria asks
  for that surface specifically, and the domain guard (`rootEvidenceChanges`) is
  already in place for whenever a metadata-only edit path is built.
- **A write that succeeds but whose subsequent Garden reopen fails is not surfaced
  as its own UI state.** `Workspace.refreshGarden` silently leaves the Tree showing
  pre-write state if `openGarden` fails after a successful, verified write. The
  write's own result (already returned to the caller and recorded in Activity) is
  accurate regardless; a dedicated "the write succeeded but the Garden could not be
  reopened" banner was judged out of this ticket's scope, since reopening itself was
  already an established, tested path (`createGarden`'s own reopen-after-write has
  the same shape) and no criterion asks for it. Left as a known, minor gap rather
  than papered over.
- **Duplicated `kind`-discriminated result-type shapes** across `EditItemResult` and
  `UndoChangeResult` (e.g. both repeat `permission-required`/`stale`/
  `verification-failed`/`failed` variants) were flagged as Duplicated Code. Left as
  is: this matches the established shape of `OpenGardenResult` and
  `CreateGardenResult` elsewhere in `src/garden/`, where each Garden Action owns its
  own outcome union rather than sharing one across actions.

### Verification run

`pnpm typecheck`, `pnpm test` (1124 tests across 37 files, all passing), and
`pnpm build` all pass clean as of the final commit on this branch.
