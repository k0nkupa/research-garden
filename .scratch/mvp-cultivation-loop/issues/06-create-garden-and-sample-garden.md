# 06: Create Garden and the Sample Garden

**What to build:** A person chooses Create Garden, selects an empty folder, and Research Garden materializes a real Sample Garden into it as actual files on their disk — not a browser-only demo. The Tree grows from what was written. The Sample Garden contains a genuine contradiction between two supported Claim Leaves, so the defining workflow is demonstrable from a standing start.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Create Garden requires the person to select a local folder
- [ ] Create Garden refuses a folder that already contains conflicting content, without overwriting anything
- [ ] Create Garden materializes real Sample Garden files into the selected folder
- [ ] The materialized Sample Garden validates against the full schema and all graph invariants
- [ ] The Sample Garden contains at least two supported Claim Leaves with an explicit Contradicts relationship between them, each backed by its own Root
- [ ] The Sample Garden contains at least one Question Leaf that a Harvest could later answer
- [ ] The Tree grows from the materialized files immediately after creation
- [ ] Research Garden remembers the Garden Repository's directory handle and display name in browser-local storage, and stores no canonical content there
- [ ] A returning person can resume a remembered Garden, and is asked for file permission again whenever the browser requires it

## Inherited from ticket 03

This is the first ticket that writes a file, so it should verify and tick these ticket 03
criteria, which are implemented and unit-tested but have no caller yet:

- [ ] Materialized filenames are readable title slugs (`titleSlug`)
- [ ] A short identity suffix is appended only to resolve a collision (`fileNameFor`)
- [ ] Newly created files use the documented canonical field order (`CANONICAL_FIELD_ORDER`)
