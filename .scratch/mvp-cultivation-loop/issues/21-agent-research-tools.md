# 21: Agent research tools

**What to build:** A browser agent can do genuine research over a Garden rather than only file operations. It can walk into a Branch, follow evidence from a conclusion back to its Roots, find what remains unanswered, and find where the person's own supported Claims disagree with each other. These are the tools that make the contradiction in the defining workflow findable rather than staged.

**Blocked by:** 19

**Status:** ready-for-agent

- [ ] Explore Branch returns the structure and contents of one Branch within read bounds
- [ ] Trace evidence returns the complete provenance and evidence path for an item back to its Roots
- [ ] Find open questions returns Question Leaves that no Harvest currently answers
- [ ] Find contradictions returns pairs of Claim Leaves joined by a Contradicts relationship, with their supporting Roots
- [ ] Prepare source comparison returns a structured starting point for comparing two or more Roots
- [ ] Prepare Seed cultivation returns a structured starting point for growing knowledge from a Seed, without modifying the Seed
- [ ] All of these tools are non-mutating and declare themselves read-only
- [ ] All results carrying user content declare untrusted content
- [ ] All results respect the read bounds and report truncation where it applies
- [ ] All results carry the current Garden Revision and appear in the Garden Activity feed
