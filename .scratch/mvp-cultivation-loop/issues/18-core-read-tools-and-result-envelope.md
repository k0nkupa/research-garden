# 18: Core read tools, result envelope, annotations, and bounded reads

**What to build:** A connected browser agent can orient itself in a Garden and retrieve what it needs to reason, without one call silently consuming the whole Garden or its own context. Every result arrives in a predictable envelope carrying the current Garden Revision, so the agent can tell whether what it holds is still true, and stable error codes, so it can respond to a stale proposal differently from a lost permission. Content that came out of the person's files is marked untrusted, because instructions embedded in a note are not instructions from the person.

**Blocked by:** 11, 17

**Status:** ready-for-agent

- [ ] Inspect, search, read items, and audit tools are registered after Agent Access is enabled
- [ ] Every tool returns a common envelope carrying success or a stable error code, structured data, the current Garden Revision, retryability, and warnings
- [ ] The error contract includes distinguishable browser, permission, lookup, schema, relation, inspection, staleness, confirmation, and write failures
- [ ] No tool signals outcome through prose alone or through an uncaught exception
- [ ] Non-mutating tools declare themselves read-only
- [ ] Any result carrying Seed, Root, Leaf, Harvest, URL, excerpt, or search-snippet content declares untrusted content
- [ ] Inspection and search return metadata and short snippets only, never full bodies
- [ ] Search defaults to ten results and caps at twenty-five
- [ ] Read items accepts at most five stable item IDs
- [ ] Read items reports explicit truncation and continuation information for bounded bodies
- [ ] Audit exposes Garden Diagnostics including invalid items
- [ ] Tools accept stable item IDs and never a caller-supplied filesystem path
- [ ] Every tool invocation appears in the Garden Activity feed as action, time, affected item IDs, and outcome, without raw content
- [ ] The tools call the same underlying behaviour as the human interface rather than reimplementing it
