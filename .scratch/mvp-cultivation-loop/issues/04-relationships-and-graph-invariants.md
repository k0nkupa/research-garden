# 04: Relationships, graph invariants, and Tree projection

**What to build:** A person's Garden shows a Tree where every item has exactly one primary location, while relationships that cross topics appear as Cross-links without moving anything. The graph stays coherent because Research Garden refuses to build an incoherent one: no invented relationship names, no self-links, no duplicates, no impossible kind pairings, and no cycles in placement.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Exactly six relationships are recognized: Parent, Derived From, Supports, Answers, Contradicts, Relates To
- [ ] Parent, Derived From, Supports, and Answers are directional; Contradicts and Relates To are symmetric Cross-links
- [ ] Self-links, duplicate relationships, and invalid source and target kind pairings are rejected
- [ ] Parent placement must be acyclic; non-parent Cross-links may form cycles
- [ ] Branches may be top-level or nested; every Leaf and Harvest requires a Branch parent; Seeds and Roots require no parent and occupy their own strata
- [ ] Claim Leaves and Harvests require at least one supporting Root; Question, Idea, and Observation Leaves may be unsourced
- [ ] Claim Leaves and Harvests serialize their evidence as an item-local reference to supporting Roots, so adding knowledge never mutates a Root
- [ ] Inverse relationships are derived during scanning and never written into a second file
- [ ] Cultivated Seed status is derived from incoming Derived From relationships; cultivation never rewrites, moves, or replaces a Seed
- [ ] Contradictory supported Claims are both preserved along with their Roots and an explicit Contradicts relationship
- [ ] The Tree is projected from frontmatter relationships, not from storage layout, with one implicit trunk holding top-level Branches
- [ ] Cross-links are visible in the Tree without changing an item's primary location

## Already landed in ticket 02

Verify rather than rebuild:

- `parent_id` validated as a kind-prefixed ULID
- inverse `childIds` derived at scan time, never written to a second file
- the implicit trunk and top-level placement
- a dangling `parent_id` reported as a Garden Diagnostic with the item still placed at
  the top level rather than dropped
