# 22: Agent proposal tools

**What to build:** A browser agent can propose changes to existing knowledge — a new relationship, a move, or a Harvest synthesizing what it found — and none of it touches the person's files. Each proposal becomes a Pending Change with an exact one-file preview waiting in the Change Tray. This is where the product's promise is kept: the agent did the reasoning, and the person still holds the approval.

**Blocked by:** 19, 20

**Status:** ready-for-agent

- [ ] Propose relation creates a Pending Change adding one recognized relationship, with an exact one-file preview
- [ ] Propose move creates a Pending Change reparenting one item, with an exact one-file preview
- [ ] Propose Harvest creates a Pending Change materializing one Harvest, with an exact one-file preview
- [ ] A proposed Harvest contains all five required sections and cites at least one supporting Root
- [ ] A proposed Harvest that addresses a Question Leaf carries an Answers relationship to it
- [ ] A proposed Harvest over contradictory Claims preserves both Claims and explains the uncertainty rather than choosing a winner
- [ ] Every proposal is validated against the schema and graph invariants before the preview is produced
- [ ] A proposal that would violate an invariant is refused with a stable error code, not persisted as an unappliable change
- [ ] No proposal writes to a canonical file
- [ ] Every proposal touches at most one canonical file in its preview
- [ ] Proposals appear immediately in the Change Tray for human review
- [ ] Every proposal appears in the Garden Activity feed and returns the common envelope
