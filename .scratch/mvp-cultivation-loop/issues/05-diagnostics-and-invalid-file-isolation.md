# 05: Garden Diagnostics and invalid-file isolation

**What to build:** A person with one malformed file in their Garden still gets to work. The rest of the Garden opens normally, the broken file is surfaced as a visible Garden Diagnostic explaining what needs attention, and Research Garden refuses to mutate it until it validates. Nothing is hidden and nothing is quarantined out of sight.

**Blocked by:** 04

**Status:** resolved

- [x] An invalid canonical file produces a Garden Diagnostic and does not prevent unrelated valid files from loading
- [x] The Diagnostic explains what requires attention on which item
- [x] Diagnostics are visible in the workspace
- [x] Invalid items remain enumerable for auditing rather than being hidden
- [x] Relationships referencing items that do not exist are reported as Diagnostics rather than silently dropped
- [ ] Mutations targeting an invalid item are blocked until its known fields and relationships validate
- [x] A Garden whose every file is malformed still opens and explains itself rather than failing opaquely

## Notes

Verified: `pnpm typecheck` clean, `pnpm test` 636 passing across 20 files, `pnpm build`
succeeds. The shipped bundle was driven in real headless Chromium against a Garden
containing one file with no frontmatter and one Claim Leaf naming a missing item: 10 nodes
rendered, the bar showed "2 Diagnostics", the Claim carried `aria-invalid`, and the panel
listed both files with explanations.

### The bug review caught

Two files claiming one id blamed the wrong one. The losing file's Diagnostic was tagged
with the id it *tried* to claim -- which belongs to the file that claimed it first -- so
the valid item was marked in the Tree, told it could not be changed, and linked to from
the Diagnostics list under the impostor's title. One file was broken and the other one was
punished for it.

A duplicate-id Diagnostic now attributes to no item, because the id is not the loser's to
claim. It still carries the losing file's title and path, so the file can be found.

### The mutation-blocking criterion is left unticked

"Mutations targeting an invalid item are blocked until its known fields and relationships
validate" -- `src/garden/mutationGuard.ts` implements and tests the check, but nothing in
this build writes, so nothing calls it and the criterion cannot fail. Same position as the
five deferred criteria on ticket 03. Tickets 12, 20, and 22 are the first writers and have
been annotated.

### Deliberate deviation from ADR 0019

ADR 0019 assigns the right-hand panel to the selected item. Garden Diagnostics share it
rather than taking a region of their own: they are something a person visits when a file
needs attention, not a permanent fixture, and a separate region would take space from the
Tree that the same ADR makes primary. The panel returns to the selected item as soon as
one is chosen. Recorded here rather than silently absorbed.

## Already landed in ticket 02

Verify rather than rebuild -- the mechanism exists, the product behaviour does not:

- `GardenDiagnostic` is produced for unparseable frontmatter, failed schema validation,
  duplicate item ids, and dangling `parent_id`
- valid items keep loading when another file is invalid

Still owned here: surfacing Diagnostics in the workspace, keeping invalid items
enumerable for auditing, and blocking mutations against them.
