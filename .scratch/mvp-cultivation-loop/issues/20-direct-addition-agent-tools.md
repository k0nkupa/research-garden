# 20: Direct-addition agent tools — plant Seed, capture Root, add Leaf

**What to build:** A browser agent can preserve what it has been reading and contribute a thought, without either being buried in approval ceremony. These are additions that create one new file and nothing else, so they apply directly. Crucially, evidence is what the agent supplied and nothing more: Research Garden validates and persists a captured Root's exact content, does not summarize it, and does not go and fetch anything itself.

**Blocked by:** 18

**Status:** ready-for-agent

- [ ] Plant Seed creates one new Seed file directly, preserving the supplied body verbatim
- [ ] Capture Root accepts a title, origin URL, exact excerpt or content, and optional attribution
- [ ] Capture Root validates and persists the supplied payload and stores origin metadata, capture time, and a content hash
- [ ] Capture Root never stores an agent-authored summary of the evidence
- [ ] Research Garden never fetches or scrapes a webpage on its own behalf
- [ ] Add Leaf creates one new Leaf of the requested kind directly
- [ ] A Claim Leaf cannot be added without at least one supporting Root
- [ ] Each of these actions creates or updates at most one canonical Markdown file and records an Undo Snapshot
- [ ] Each action validates against the full schema and graph invariants before writing, and runs the verified write sequence
- [ ] Each action returns the common envelope with the updated Garden Revision
- [ ] Each action appears in the Garden Activity feed and the new item appears in the Tree
