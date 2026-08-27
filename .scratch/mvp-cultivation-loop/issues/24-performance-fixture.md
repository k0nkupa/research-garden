# 24: Performance fixture at 1,000 items and 5,000 relations

**What to build:** A person with a real research workload rather than a demo still gets a usable product. Indexing and search hold up against a Garden of a thousand items and five thousand relationships, collapse and focus keep the drawn Tree bounded, and a Garden larger than the target degrades honestly with a warning instead of a hard rejection or destructive behaviour.

**Blocked by:** 11, 15

**Status:** ready-for-agent

- [ ] A generator produces a Garden fixture of 1,000 items and 5,000 relationships that validates against the full schema and all graph invariants
- [ ] Indexing the fixture from canonical Markdown remains usable and is measured
- [ ] Reopening the fixture with a warm Index Cache is measurably faster than a cold open
- [ ] Search over the fixture remains usable and is measured
- [ ] Branch collapse and Branch focus bound the visible SVG workload on the fixture
- [ ] A Garden larger than the fixture target receives a performance warning
- [ ] No hard item limit and no destructive behaviour is imposed on a larger Garden
- [ ] The measurements are recorded as repeatable evidence rather than a one-off observation
