# 12: Human edit with verified write, Undo Snapshot, and Activity feed

**What to build:** The first path that changes a person's files. They read an item, choose Edit, get the plain Markdown, and save. Research Garden snapshots the previous content, writes once, rereads what it wrote, revalidates it, and confirms its hash before reporting success — a browser acknowledgement is never treated as completion. They can undo. Their hand-authored frontmatter and untouched prose survive, and the diff stays small. The Garden Activity feed records that it happened without becoming a second copy of their content.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] The reading panel offers an explicit Edit mode that presents the plain Markdown
- [ ] Saving an edit touches at most one canonical Markdown file
- [ ] The previous content is saved as an Undo Snapshot before the file is replaced
- [ ] The write sequence is: revalidate permission and target hash, snapshot, write once, reread, revalidate, confirm content hash, then report
- [ ] A write that fails hash confirmation is reported as a failure, not a success
- [ ] Unknown frontmatter fields, comments, and untouched body text survive the edit
- [ ] Changing one known field does not fully normalize the rest of the file
- [ ] The item's update timestamp changes and its creation timestamp does not
- [ ] Undo restores the exact snapshot, and is permitted only while the current file still matches the applied change's resulting hash
- [ ] Undo leaves the resulting file record intact so recovery is itself auditable
- [ ] The Garden Activity feed shows action name, time, affected item IDs, and outcome, with no raw bodies
- [ ] Actions address items by stable ID; no action accepts an absolute or caller-supplied filesystem path
- [ ] Canonical writes resolve only to typed Garden directories and operational writes only to defined operational locations

## Inherited from ticket 04

- [ ] Adding or editing knowledge never rewrites a Root, because Supports is serialized on
      the Claim or Harvest (ADR 0020). Structurally true today, but unfalsifiable until a
      write path exists.

## Inherited from ticket 03

This is the first ticket that edits an existing item, so it should verify and tick these
ticket 03 criteria:

- [ ] `updated_at` moves only when the canonical item is actually edited, and `created_at`
      never moves (ADR 0077)
- [ ] A proposed change to a Root that would rewrite its captured evidence is refused;
      only its metadata is correctable (`rootEvidence.ts`, ADR 0012)
