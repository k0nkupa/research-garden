# 03: Full canonical item schema across all eight kinds

**What to build:** A person opens a Garden containing Seeds, Roots, Branches, all four Leaf kinds, and Harvests, and every one of them parses, validates, and appears in the Tree with its own recognizable form. Their folder remains pleasant to browse without Research Garden: readable filenames, readable frontmatter, and their own hand-authored metadata surviving untouched.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] All eight kinds parse and validate: Seed, Root, Branch, Claim Leaf, Question Leaf, Idea Leaf, Observation Leaf, Harvest
- [ ] Canonical Markdown is organized under per-kind directories with attachments separate and operational state under the dotted operational directory
- [ ] Every item carries a kind-prefixed ULID in frontmatter, and its filename is a readable title slug
- [ ] A short identity suffix is appended to a filename only when needed to resolve a collision
- [ ] Universal frontmatter carries schema version, id, kind, kind-specific fields, title, optional parent id, relations, and creation and update timestamps
- [ ] Timestamps serialize as ISO 8601 UTC; creation time is stable for an item's lifetime and update time changes only on canonical edit
- [ ] Unknown frontmatter fields and comments survive read and write cycles
- [ ] Newly created files use the documented canonical field order; existing files are not fully normalized when one known field changes
- [ ] A Harvest requires Question, Synthesis, Evidence, Contradictions and uncertainty, and Open questions sections
- [ ] A Root stores origin metadata, capture time, content hash, and the exact excerpt, and carries no agent-authored summary
- [ ] Root captured evidence is immutable after creation; only Root metadata is correctable
- [ ] Seeds, Branches, and Leaves require only a title and body with no mandatory sections
- [ ] Each kind renders in the Tree with a distinct shape, icon, text label, and colour treatment; meaning never depends on colour alone
- [ ] Seeds use pods, Roots use outlined evidence nodes, Branches use labelled junctions, Claim Leaves use filled leaves, Question Leaves use open rings, Idea Leaves use buds, Observation Leaves use lens forms, and Harvests use golden markers
