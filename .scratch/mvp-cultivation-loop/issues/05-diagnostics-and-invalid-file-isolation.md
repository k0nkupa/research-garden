# 05: Garden Diagnostics and invalid-file isolation

**What to build:** A person with one malformed file in their Garden still gets to work. The rest of the Garden opens normally, the broken file is surfaced as a visible Garden Diagnostic explaining what needs attention, and Research Garden refuses to mutate it until it validates. Nothing is hidden and nothing is quarantined out of sight.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] An invalid canonical file produces a Garden Diagnostic and does not prevent unrelated valid files from loading
- [ ] The Diagnostic explains what requires attention on which item
- [ ] Diagnostics are visible in the workspace
- [ ] Invalid items remain enumerable for auditing rather than being hidden
- [ ] Relationships referencing items that do not exist are reported as Diagnostics rather than silently dropped
- [ ] Mutations targeting an invalid item are blocked until its known fields and relationships validate
- [ ] A Garden whose every file is malformed still opens and explains itself rather than failing opaquely

## Already landed in ticket 02

Verify rather than rebuild -- the mechanism exists, the product behaviour does not:

- `GardenDiagnostic` is produced for unparseable frontmatter, failed schema validation,
  duplicate item ids, and dangling `parent_id`
- valid items keep loading when another file is invalid

Still owned here: surfacing Diagnostics in the workspace, keeping invalid items
enumerable for auditing, and blocking mutations against them.
