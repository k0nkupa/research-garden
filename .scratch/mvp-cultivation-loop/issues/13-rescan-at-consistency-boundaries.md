# 13: Rescan at consistency boundaries

**What to build:** A person who edits a file in another editor finds that Research Garden notices. The Garden is rescanned when the window regains focus, when they press Refresh, and immediately before any action whose correctness depends on current files — but the folder is never continuously polled.

**Blocked by:** 12

**Status:** resolved

- [x] The Garden Repository is rescanned when the window regains focus
- [x] An explicit Refresh control rescans on demand
- [x] A rescan runs immediately before any consistency-sensitive action
- [x] There is no continuous polling of the folder
- [x] The Garden Revision updates when canonical content has changed
- [x] An external edit made outside Research Garden is reflected at the next consistency boundary
- [x] An external deletion or addition is reflected at the next consistency boundary
- [x] A rescan that surfaces newly invalid content produces Diagnostics without disrupting unrelated work

## Notes

### What was built

There was already exactly one function that scans a Garden Repository into a
Garden Index: `openGarden`. A rescan is nothing more than calling it again on
the same folder, so this ticket added no second scanning path — only the
boundaries that call it. `Workspace.tsx`'s existing `refreshGarden` (which
ticket 12 used only to reopen after a successful write) generalized into
`rescanGarden`, wired to: a `window` `focus` listener (matching the
`resize`/`online`/`offline` idiom `App.tsx` already uses), an explicit
Refresh control in the workspace bar, and immediately before `editItem`
(Save) — the one Garden Action today whose correctness genuinely depends on
more than the target file's own hash, since `ensureMutable` and the
Root-evidence check both consult the whole Index, not just the file being
edited. `undoChange` takes no Index at all and makes its own current-files
check directly against the target file's hash, so a rescan immediately
before it would be inert; only the existing post-restore rescan applies
there, exactly as it already did.

`garden` stays local React state in `Workspace`, replaced by each rescan's
result without unmounting anything, so a rescan can never reset selection,
the Tree's pan/zoom, or an open Edit draft — this was true before this
ticket and remains the reason it still is. A rescan that itself fails
(permission lapsed, the folder is gone) surfaces in a dismissable notice
rather than disturbing what is on screen.

### Verified

Typecheck, 1184 tests (up from 1170), and a production build all pass, the
full suite run three times with no flake.

`openGarden.test.ts` gained direct tests proving a rescan (calling
`openGarden` again on the same folder) reflects an external edit, an
external addition, and an external deletion; that the Garden Revision moves
when content changes and stays put when it does not; and that newly invalid
content produces a Diagnostic for the file that broke while an unrelated
item stays exactly as it was. `InMemoryGardenFileSystem` gained a `remove()`
test affordance (matching the existing `revokePermission`/`snapshot`
convention) to simulate an external deletion.

A new `src/workspace/rescanAtConsistencyBoundaries.test.tsx` proves the
boundaries themselves, through the real `Workspace`: window focus and the
Refresh control both pick up a file added outside Research Garden; nothing
is rescanned across 30 simulated minutes with fake timers installed *before*
mount (so a `setInterval` registered at mount would have been caught, not
missed); a rescan whose failure is surfaced does not disturb the Tree or
panel already on screen; and, for the pre-mutation criterion specifically,
a scenario a per-file hash check cannot catch on its own -- externally
deleting the parent a mid-edit item's file declares, which the file's own
content never reveals -- is caught by the pre-Save rescan and the edit is
blocked without overwriting anything.

Verified in a real browser (headless Chrome over CDP, driven through the
application's own Open Garden button, against the real
`FileSystemAccessGardenFileSystem` adapter): a file written directly to the
folder appears in the Tree after a window blur/focus cycle, with its full
accessible name intact; a Refresh click when nothing had changed was
confirmed to be a correct no-op; no console errors or exceptions either way.

### What the review caught, and what changed

Both review axes (Standards and Spec, both Opus) independently converged on
the same real defect: the first version had concurrent rescans coalesce
into one shared in-flight `Promise`, reasoning that a focus event landing
mid-Save would otherwise race a second scan against the first. Both
reviewers showed this was worse than the problem it solved -- a rescan
requested *because* something was about to depend on current files (the
pre-Save check, the post-write reread ADR 0055 asks for) could be handed an
earlier scan that started before the moment that mattered, silently
defeating exactly the freshness guarantee ticket 13 exists to provide. The
coalescing was removed; every call to `rescanGarden` now runs its own
independent scan (cheap -- a handful of local file reads), tracked only by
an in-flight counter so the busy indicator clears once every overlapping
scan has finished. A new regression test (`concurrent rescans`) proves a
second rescan requested while an earlier one is still blocked mid-scan runs
its own scan rather than waiting on or inheriting the first's result; it
was confirmed to fail against the original coalescing code before the fix
and pass after.

The same review also caught: the pre-Undo rescan was inert (its result was
discarded and `undoChange` does not consult the Index), so it was removed
rather than kept as a comment justifying a call that did nothing; real CSS
duplication between the new `.workspace__refresh` and the existing
`.workspace__panel-toggle` pill geometry, fixed by combining both classes on
one element rather than repeating five declarations; and a rescan-failure
notice whose own CSS overrode three properties of the `.notice` class it was
built on (fighting its own base rather than using it), fixed by dropping the
override and reusing `.notice.notice--failure` exactly as `ItemPanel`
already does.

Fixing the coalescing bug surfaced an unrelated pre-existing false positive
in the ADR 0044 muted-ink guard (`src/entry/build-constraints.test.ts`): its
regex matched the literal text `color:` anywhere in a declaration, so the
new `.workspace__refresh`'s `border-color:` was misread as muted text ink
purely because that property name also ends in "color:". This is not a
readability property -- border decoration is not WCAG text contrast's
business -- so the regex was anchored with a negative lookbehind to exclude
compound property names, and mutation-tested to confirm it still catches a
genuinely lowered text-color mix.

Fixing the review findings also surfaced a real flaky test of my own: an
assertion checking the Tree for an externally-added item was not wrapped in
its own `waitFor`, wrongly assuming that a successful file write and the
Tree re-rendering to reflect it were the same moment. It passed in
isolation (enough incidental delay from a `waitFor` polling loop earlier in
the same test) and failed under the full suite's heavier load. Fixed, then
the full suite was run three times clean to confirm.

No criterion is left unticked. Rescanning currently has two real callers in
this codebase -- Save and Undo -- and the ticket's later phrase "any
consistency-sensitive action" is read against that literal surface, not a
hypothetical one: agent tools that will eventually mutate files (tickets
20-23) do not exist yet, so there is nothing there for a rescan to run
before.
