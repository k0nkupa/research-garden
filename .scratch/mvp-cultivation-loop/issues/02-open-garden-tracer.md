# 02: Open Garden tracer — folder to Tree to reader

**What to build:** A person chooses Open Garden, selects a local folder containing a single Branch item, and sees that item appear as a node in the Tree. Selecting the node opens its content in the reading panel. This is the narrowest complete path through every layer of the product, and it establishes the boundaries everything else is built on: the filesystem port, the document model, schema validation, the Garden Index, the SVG Tree, and the reading panel.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] A filesystem port abstracts directory access, read, single write, and permission state, with both an in-memory adapter and a File System Access adapter behind one contract
- [ ] Domain logic never touches the browser filesystem API directly
- [ ] Open Garden prompts for a local folder and scans its canonical Markdown
- [ ] A document model parses frontmatter and body, and serializes back preserving unknown fields, comments, and untouched body text through a round trip
- [ ] Schema validation accepts a well-formed Branch item and rejects a malformed one
- [ ] An in-memory Garden Index is built from the scanned Markdown and is never treated as the source of truth
- [ ] A Garden Revision is derived from canonical content
- [ ] The Tree renders as purpose-built accessible SVG with a semantic label for the node; the hierarchy library computes layout and paths only and owns no application state
- [ ] Selecting the node opens its Markdown in the reading panel, rendered with raw HTML disabled and output sanitized
- [ ] Losing folder permission mid-operation produces a clear recoverable state rather than a crash or a partially executed action
- [ ] The filesystem port contract suite runs against the in-memory adapter under the unit test run
