# 04: Relationships, graph invariants, and Tree projection

**What to build:** A person's Garden shows a Tree where every item has exactly one primary location, while relationships that cross topics appear as Cross-links without moving anything. The graph stays coherent because Research Garden refuses to build an incoherent one: no invented relationship names, no self-links, no duplicates, no impossible kind pairings, and no cycles in placement.

**Blocked by:** 03

**Status:** resolved

- [x] Exactly six relationships are recognized: Parent, Derived From, Supports, Answers, Contradicts, Relates To
- [x] Parent, Derived From, Supports, and Answers are directional; Contradicts and Relates To are symmetric Cross-links
- [x] Self-links, duplicate relationships, and invalid source and target kind pairings are rejected
- [x] Parent placement must be acyclic; non-parent Cross-links may form cycles
- [x] Branches may be top-level or nested; every Leaf and Harvest requires a Branch parent; Seeds and Roots require no parent and occupy their own strata
- [x] Claim Leaves and Harvests require at least one supporting Root; Question, Idea, and Observation Leaves may be unsourced
- [x] Claim Leaves and Harvests serialize their evidence as an item-local reference to supporting Roots, so adding knowledge never mutates a Root
- [x] Inverse relationships are derived during scanning and never written into a second file
- [x] Cultivated Seed status is derived from incoming Derived From relationships; cultivation never rewrites, moves, or replaces a Seed
- [x] Contradictory supported Claims are both preserved along with their Roots and an explicit Contradicts relationship
- [x] The Tree is projected from frontmatter relationships, not from storage layout, with one implicit trunk holding top-level Branches
- [x] Cross-links are visible in the Tree without changing an item's primary location

## Notes

Verified: `pnpm typecheck` clean, `pnpm test` 585 passing across 19 files, `pnpm build`
succeeds. The shipped bundle was driven in real headless Chromium against a Garden with
two contradicting Claim Leaves each backed by its own Root, a Harvest answering a Question
Leaf and citing both Roots, and a Claim derived from a Seed: 10 nodes, exactly 1
Contradicts Cross-link, 4 Supports, 1 Answers, 1 Derived From, 0 Parent edges drawn as
Cross-links, 0 Diagnostics, both Claims still at depth 2. The Claim's accessible
description read "Supports 1, Contradicts 1, Derived From 1".

### The bug review caught

A symmetric Cross-link declared by *both* sides was stored twice -- one fact in two files,
two identical curves drawn, and "Contradicts 2" announced for a single contradiction. My
test had blessed it, asserting only that no Diagnostic was raised.

The fix deduplicates rather than rejects. ADR 0021 constrains what Research Garden
*writes*: it must never write the inverse. A person may legitimately have written both
sides by hand, and for a symmetric relation both statements are true, so there is nothing
to resolve and nothing to complain about. The graph now keys a symmetric relationship on
its unordered pair, so one fact is one relationship however many files state it.

Every edge check now lives in the graph pass. Half of them had been in the schema, which
meant two places deciding what an edge is and the same enumeration written twice.

### Criterion 7 is structurally satisfied but not yet falsifiable

"Claim Leaves and Harvests serialize their evidence as an item-local reference to
supporting Roots, so adding knowledge never mutates a Root" -- the model holds Supports
once, running Root to Claim, recorded as declared on the Claim. But no write path exists
anywhere in the build, so "never mutates a Root" cannot yet fail. Ticket 12 is the first
edit path and should confirm it.

### Minor scope beyond the ticket

- Per-type Cross-link colours for Supports, Answers, and Derived From reach toward
  ADR 0045, which is ticket 09. The dashed mulberry Contradicts is in scope here.
- `.garden-tree { margin: auto }` replaces flex centring, which pushed an overflowing Tree
  into negative scroll space and left its left-hand side permanently unreachable. Pan and
  zoom remain ticket 08; this is a bug fix, verified in a real browser.

## Already landed in ticket 03

Verify rather than rebuild:

- a Claim Leaf and a Harvest must each cite at least one Root (`supported_by`, non-empty)
- `parent_id` must name a Branch, since a Branch is the only kind that can be a parent
- every Leaf and Harvest must declare a parent; a Root must not; a Branch may be top-level

Still owned here: the six-relation vocabulary itself, directional versus symmetric
handling, rejection of self-links and duplicates, kind pairings, Parent-cycle rejection,
and verifying that every referenced id resolves to a real item of the expected kind --
including the ids in `supported_by`.

## Already landed in ticket 02

Verify rather than rebuild:

- `parent_id` validated as a kind-prefixed ULID
- inverse `childIds` derived at scan time, never written to a second file
- the implicit trunk and top-level placement
- a dangling `parent_id` reported as a Garden Diagnostic with the item still placed at
  the top level rather than dropped
