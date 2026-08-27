# 03: Full canonical item schema across all eight kinds

**What to build:** A person opens a Garden containing Seeds, Roots, Branches, all four Leaf kinds, and Harvests, and every one of them parses, validates, and appears in the Tree with its own recognizable form. Their folder remains pleasant to browse without Research Garden: readable filenames, readable frontmatter, and their own hand-authored metadata surviving untouched.

**Blocked by:** 02

**Status:** resolved

- [x] All eight kinds parse and validate: Seed, Root, Branch, Claim Leaf, Question Leaf, Idea Leaf, Observation Leaf, Harvest
- [x] Canonical Markdown is organized under per-kind directories with attachments separate and operational state under the dotted operational directory
- [ ] Every item carries a kind-prefixed ULID in frontmatter, and its filename is a readable title slug
- [ ] A short identity suffix is appended to a filename only when needed to resolve a collision
- [x] Universal frontmatter carries schema version, id, kind, kind-specific fields, title, optional parent id, relations, and creation and update timestamps
- [ ] Timestamps serialize as ISO 8601 UTC; creation time is stable for an item's lifetime and update time changes only on canonical edit
- [x] Unknown frontmatter fields and comments survive read and write cycles
- [ ] Newly created files use the documented canonical field order; existing files are not fully normalized when one known field changes
- [x] A Harvest requires Question, Synthesis, Evidence, Contradictions and uncertainty, and Open questions sections
- [x] A Root stores origin metadata, capture time, content hash, and the exact excerpt, and carries no agent-authored summary
- [ ] Root captured evidence is immutable after creation; only Root metadata is correctable
- [x] Seeds, Branches, and Leaves require only a title and body with no mandatory sections
- [x] Each kind renders in the Tree with a distinct shape, icon, text label, and colour treatment; meaning never depends on colour alone
- [x] Seeds use pods, Roots use outlined evidence nodes, Branches use labelled junctions, Claim Leaves use filled leaves, Question Leaves use open rings, Idea Leaves use buds, Observation Leaves use lens forms, and Harvests use golden markers

## Notes

Verified: `pnpm typecheck` clean, `pnpm test` 479 passing across 17 files, `pnpm build`
succeeds. The shipped bundle was driven in real headless Chromium against a Garden
holding all eight kinds: 8 nodes rendered with 8 distinct shapes, each accessible name
naming its kind, the Harvest's five sections rendered in the panel, and a measured 0
overlapping and 0 clipped labels.

### Five criteria left unticked, all for one reason

Nothing in this build writes a file yet. Every unticked criterion is a statement about
what happens at creation or edit time, so each is *defined and unit-tested here* but has
no enforcement point until a write path exists:

- **filename is a readable title slug** and **short identity suffix only on collision** --
  `titleSlug` and `fileNameFor` are implemented and tested, with no production caller.
- **update time changes only on canonical edit** -- the format and the
  never-earlier-than-creation rule are enforced; what moves the timestamp is a writer's
  business.
- **newly created files use the documented canonical field order** -- `CANONICAL_FIELD_ORDER`
  is declared and tested; applying it needs a writer.
- **Root captured evidence is immutable, only metadata correctable** -- `rootEvidence.ts`
  defines the partition and reports exactly which evidence a proposed change would rewrite.
  Nothing consults it yet.

Ticket 06 (Create Garden) is the first writer and should tick the filename, suffix, and
field-order criteria. Ticket 12 (human edit) should tick the timestamp and Root-evidence
criteria. Both have been annotated.

### Work belonging to later tickets that landed here

- **Ticket 04**: `supported_by` must cite at least one Root, `parent_id` must name a
  Branch, Leaves and Harvests must declare a parent, Roots and Seeds must not. These are
  frontmatter shape rules and sit naturally beside the schema. Ticket 04 still owns the
  six-relation vocabulary, symmetry, kind pairings, cycle rejection, derived inverses, and
  verifying that every referenced id resolves to a real item of the right kind.

### Test infrastructure change

`vite.config.ts` now defaults to `environment: 'node'`, with the five DOM-dependent test
files opting into jsdom by docblock. This was not requested by the ticket. It was forced:
importing jsdom took 23s on this machine, which pushed vitest past its 60s worker-startup
timeout and made the suite unrunnable. Domain and filesystem tests never needed a DOM --
the layering test in `build-constraints.test.ts` proves it -- and setup time fell from
160s to under 1s.

### Known gap

`relations` is validated for shape only: an unrecognized relationship type is accepted and
produces no Diagnostic. Nothing consumes `relations` yet, so no incoherent graph can be
rendered, but a Garden authored today could look clean and start reporting Diagnostics
when ticket 04 lands. That is the documented boundary, not an oversight.
