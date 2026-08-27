# 14: Pending Change lifecycle and Change Tray

**What to build:** Proposed mutations become continuously visible without taking over the workspace. The Change Tray sits as a thin rail when there is nothing to review and expands when a Pending Change appears. Opening a change shows the exact one-file diff that would be written, without hiding the Tree. Approving it revalidates everything before writing; rejecting it is a first-class outcome; and a proposal built against content that has since changed becomes Stale rather than overwriting newer work. Pending Changes survive a page reload and travel with the folder, while remaining plainly not knowledge.

**Blocked by:** 13

**Status:** ready-for-agent

- [ ] A Pending Change carries an exact one-file preview of what would be written
- [ ] Pending Changes persist as noncanonical operational records under the defined operational location and survive a page reload
- [ ] Persisted Pending Changes never appear as canonical knowledge in the Tree, in search, or in the index
- [ ] The Change Tray is a thin status rail when empty and expands when a Pending Change appears
- [ ] Opening a change's diff does not obscure the Tree
- [ ] Approving revalidates directory permission, target content hash, preview hash, one-file scope, schema, and graph invariants before writing
- [ ] Approving then runs the full snapshot, write once, reread, revalidate, confirm-hash sequence
- [ ] A Pending Change whose target no longer matches its recorded state is marked Stale and cannot be applied
- [ ] Rejecting a Pending Change is explicit and removes it without touching canonical files
- [ ] Undo is reachable for an applied change from the tray, subject to the resulting-hash rule
- [ ] Every approval, rejection, and undo appears in the Garden Activity feed
- [ ] With the application open in two tabs, a proposal built on one tab's obsolete state becomes Stale rather than overwriting the other tab's newer content
