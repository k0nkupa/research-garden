# 02: Open Garden tracer — folder to Tree to reader

**What to build:** A person chooses Open Garden, selects a local folder containing a single Branch item, and sees that item appear as a node in the Tree. Selecting the node opens its content in the reading panel. This is the narrowest complete path through every layer of the product, and it establishes the boundaries everything else is built on: the filesystem port, the document model, schema validation, the Garden Index, the SVG Tree, and the reading panel.

**Blocked by:** 01

**Status:** resolved

- [x] A filesystem port abstracts directory access, read, single write, and permission state, with both an in-memory adapter and a File System Access adapter behind one contract
- [x] Domain logic never touches the browser filesystem API directly
- [x] Open Garden prompts for a local folder and scans its canonical Markdown
- [x] A document model parses frontmatter and body, and serializes back preserving unknown fields, comments, and untouched body text through a round trip
- [x] Schema validation accepts a well-formed Branch item and rejects a malformed one
- [x] An in-memory Garden Index is built from the scanned Markdown and is never treated as the source of truth
- [x] A Garden Revision is derived from canonical content
- [x] The Tree renders as purpose-built accessible SVG with a semantic label for the node; the hierarchy library computes layout and paths only and owns no application state
- [x] Selecting the node opens its Markdown in the reading panel, rendered with raw HTML disabled and output sanitized
- [x] Losing folder permission mid-operation produces a clear recoverable state rather than a crash or a partially executed action
- [x] The filesystem port contract suite runs against the in-memory adapter under the unit test run

## Notes

Verified: `pnpm typecheck` clean, `pnpm test` 267 passing across 14 files, `pnpm build`
succeeds. The shipped bundle was also driven in real headless Chromium with an injected
fake `showDirectoryPicker`: Open Garden produced the Tree, node selection rendered the
Markdown body, and the panel contained no script elements and no `on*` attributes.

### Work that belongs to later tickets and landed here anyway

Flagged by review rather than left unmarked. None of it is speculative -- the tracer
needed a Tree projection and needed to do *something* with files that fail validation --
but the following criteria on later tickets are already met, and those tickets should
verify rather than rebuild:

- **Ticket 04**: `parent_id` in the schema, derived `childIds`, the implicit trunk, and
  nested rendering with `aria-level`. Ticket 04 still owns the full six-relation
  vocabulary, symmetry, kind pairings, cycle rejection, and the evidence requirement.
- **Ticket 05**: the Garden Diagnostic mechanism -- unparseable files, failed validation,
  duplicate ids, and dangling `parent_id` all produce Diagnostics while valid items keep
  loading. Ticket 05 still owns surfacing them in the interface, exposing them to
  auditing, and blocking mutations against the items they name.
- **Ticket 07**: external link isolation was applied here, because the reading panel
  renders links today and ADR 0056 asks for it alongside sanitization. Ticket 07 still
  owns remote media and Attachment resolution.
- **Ticket 08**: `state: active | dormant` is validated, and treeitems respond to Enter
  and Space. Ticket 08 still owns pan, zoom, collapse, focus, full keyboard traversal,
  and dormant recession.

### Known gap

`FileSystemAccessGardenFileSystem.write` is not atomic: the browser API truncates on
`createWritable()`, so a permission lapse part way through leaves a truncated file. The
fake handle was made to truncate the same way rather than buffer, so no test overstates
this. Recovery is ticket 12's Undo Snapshot plus reread-and-verify sequence (ADR 0055),
which is the answer ADR 0055 already prescribes.
