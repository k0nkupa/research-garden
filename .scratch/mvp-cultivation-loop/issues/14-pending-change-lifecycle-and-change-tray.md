# 14: Pending Change lifecycle and Change Tray

**What to build:** Proposed mutations become continuously visible without taking over the workspace. The Change Tray sits as a thin rail when there is nothing to review and expands when a Pending Change appears. Opening a change shows the exact one-file diff that would be written, without hiding the Tree. Approving it revalidates everything before writing; rejecting it is a first-class outcome; and a proposal built against content that has since changed becomes Stale rather than overwriting newer work. Pending Changes survive a page reload and travel with the folder, while remaining plainly not knowledge.

**Blocked by:** 13

**Status:** resolved

- [x] A Pending Change carries an exact one-file preview of what would be written
- [x] Pending Changes persist as noncanonical operational records under the defined operational location and survive a page reload
- [x] Persisted Pending Changes never appear as canonical knowledge in the Tree, in search, or in the index
- [x] The Change Tray is a thin status rail when empty and expands when a Pending Change appears
- [x] Opening a change's diff does not obscure the Tree
- [x] Approving revalidates directory permission, target content hash, preview hash, one-file scope, schema, and graph invariants before writing
- [x] Approving then runs the full snapshot, write once, reread, revalidate, confirm-hash sequence
- [x] A Pending Change whose target no longer matches its recorded state is marked Stale and cannot be applied
- [x] Rejecting a Pending Change is explicit and removes it without touching canonical files
- [x] Undo is reachable for an applied change from the tray, subject to the resulting-hash rule
- [x] Every approval, rejection, and undo appears in the Garden Activity feed
- [x] With the application open in two tabs, a proposal built on one tab's obsolete state becomes Stale rather than overwriting the other tab's newer content

## Notes

Built as `proposeChange`, `approveChange`, `rejectChange`, and the `PendingChangeRecord`
(`pendingChange.ts`), plus `ChangeTray`/`ChangeDiffPanel`/`lineDiff` in the Workspace and
`Workspace.tsx` wiring. `proposeChange` and `editItem` now share their checks and derivation
through a new `deriveBodyEdit.ts`, so a person's own edit and an agent's proposed one can
never validate against different rules.

**A real regression the code review caught before it shipped:** extracting `deriveBodyEdit`
out of `editItem.ts` changed `now` from being called once (shared between `updated_at` and
the Undo Snapshot's `appliedAt`/`proposedAt`) to being called twice -- once inside
`deriveBodyEdit`, once again by each caller. With a real clock this would let `updated_at`
silently disagree with the record that describes writing it. The existing tests could not
catch this, because they all use fixed-clock fakes where two calls return the same string
either way. Fixed by having `deriveBodyEdit` take an already-computed instant (`now: string`)
rather than a clock to call, and added a new test in both `editItem.test.ts` and
`proposeChange.test.ts` using a clock that ticks on every call, specifically to make this
class of bug detectable -- confirmed by mutation-testing: reverting the fix reliably fails
the new test.

The same review pass also caught, and this fixed: an unintentionally reworded stale-edit
message (reverted to the original wording); `approveChange`'s `deletePendingChange` running
after a successful write with no isolating try/catch, which would have misreported a
successful approval as `'failed'` if only the cleanup step failed (now isolated, and a
mutation test confirms the isolation is real); and `approveChange` trusting a Pending
Change record's own `previewHash` for the Undo Snapshot without ever checking it actually
matches the record's `previewText` (now verified before use, refusing with `'failed'` if a
record is internally inconsistent).

Also extracted `operationalRecord.ts` to share the read/write/validate shape `pendingChange.ts`
and `undoSnapshot.ts` had each grown independently (Undo Snapshot in ticket 12, Pending
Change here) -- about 35 duplicated lines per file, flagged by review. `describeProposeChangeFailure`
is kept even though nothing calls it yet, for structural parity with the describe-failure
sibling every other action (`editItem`, `approveChange`, `rejectChange`) already has.

Strengthened four criteria that were under-proven by the original tests, rather than wrong:
Tree/search/index exclusion now goes through a real `openGarden()` scan across every
canonical directory, not a scan hand-filtered to the one directory already under test;
reload persistence now mounts a fresh `Workspace` against a folder that already has a
Pending Change record on disk, rather than only ever proposing against an already-rendered
one; the write-once claim is now backed by a `fileSystem.write` spy asserting exactly one
canonical write, with its content hash checked against the reported `resultingHash`; and the
end-to-end lifecycle test now actually clicks Undo after an approval and asserts the file
reverts and the Undo appears in the Garden Activity feed, rather than only checking that an
Undo button is present.

**Scope boundary, honestly caveated:** "graph invariants" in the approving criterion is
exercised by the code path -- `approveChange` revalidates the *entire* substituted Garden,
not just the one item, through the same `buildGardenIndex` + `diagnosticsForItem` a graph
check would use -- but every test that exercises this check does so through a schema
violation (a Harvest missing a required body section), not a graph violation (a dangling
`parent_id`, an orphaned reference). This action only ever edits body text, never frontmatter
relationships, so a body edit alone cannot structurally produce a graph-invariant violation
to test against. The check is real and would catch one if some other actor produced one
first; it is just not empirically provable from this action's own test suite.
