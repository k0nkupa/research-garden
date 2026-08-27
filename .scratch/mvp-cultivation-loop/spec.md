# Spec: MVP cultivation loop

Status: ready-for-agent
Label: ready-for-agent
Scope: full challenge MVP — the complete defining workflow end to end
Source of truth: `CONTEXT.md` (vocabulary), `docs/design/RESEARCH-GARDEN-DESIGN.md` (confirmed design record), `docs/adr/0001`–`0083`

## Problem Statement

A person accumulates research material — captures, sources, half-formed thoughts — faster than they can turn it into source-backed understanding. The tools that could help them are all wrong in the same way: to get an agent involved, the person has to hand their private material to a hosted knowledge store, an account, and a sync service, and then trust that whatever the agent writes back is correct.

They want the opposite arrangement. The material should stay in their own folder as plain Markdown they can read, edit, and take elsewhere. The agent should be genuinely useful over that material — able to follow evidence, notice that two supported Claims contradict each other, and draft a synthesis — without ever becoming the place the knowledge lives, and without being granted open-ended authority over the filesystem.

Today no such arrangement exists. A public website cannot help a browser agent work with private local knowledge, so the person's choices are a local application with no agent, or an agent with a cloud-hosted copy of everything they own.

## Solution

Research Garden is a public, local-first PWA. A person opens it with no account, selects a local folder as their Garden Repository, and gets a complete human interface over the canonical Markdown in that folder: a permanent Tree, a reading and editing panel, a Change Tray, and a Garden Activity feed. Everything works with no agent present.

When the person chooses to, they enable Agent Access for that session. Research Garden then registers a set of constrained WebMCP tools that let ChatGPT inspect the Garden, follow evidence from Roots through Claim Leaves, surface a contradiction, and propose a Harvest. The proposal does not touch the person's files. It becomes a Pending Change with an exact one-file preview that the person inspects and explicitly approves. Only then does Research Garden revalidate, snapshot, write once, reread, and confirm.

The resulting Markdown sits in the person's folder and is fully usable without Research Garden. The agent got to do the reasoning; the person kept the files and the approval.

## User Stories

### Arriving and choosing a Garden

1. As a first-time visitor, I want the application to open on a bare trunk with Create Garden and Open Garden at the soil line, so that I understand immediately that this is a Garden and not a marketing page.
2. As a first-time visitor, I want no login, signup, or account prompt anywhere, so that I can evaluate the product without surrendering an identity.
3. As a person on an unsupported browser, I want a polished explanation naming the specific missing capability, so that I know whether the problem is local-folder access, WebMCP, or both.
4. As a person on a small screen, I want a clear statement that the Garden workspace requires a compatible desktop browser, so that I am not led into a half-working mobile experience.
5. As a person with a supported browser but no WebMCP host, I want the entire human interface to remain usable, so that the product is not hostage to the agent integration.
6. As a new user, I want Create Garden to ask me for a local folder and materialize a real Sample Garden into it, so that I can see actual files rather than a browser-only demo.
7. As a new user, I want Create Garden to refuse a folder that already contains conflicting content, so that I never overwrite material I care about.
8. As a returning user, I want Open Garden to scan an existing compatible folder and grow the Tree from what is there, so that my prior work reappears.
9. As a returning user, I want Research Garden to remember my recent Garden's directory handle and display name, so that I can resume without re-navigating my filesystem.
10. As a returning user, I want Research Garden to store only that handle and name and never a copy of my content, so that my knowledge exists in exactly one place.
11. As a returning user, I want to be asked for folder permission again whenever the browser requires it, so that access is never silently persistent.
12. As a person who revoked or lost folder permission mid-session, I want a clear recoverable state rather than a crash or a partially executed action, so that I can re-grant access and continue.
13. As a person exploring the Sample Garden, I want it to contain a genuine contradiction between two supported Claim Leaves, so that the defining workflow is demonstrable from a standing start.

### Reading the Tree

14. As a person with an open Garden, I want one permanent Tree with an implicit trunk holding my top-level Branches, so that my Garden has a stable spatial identity I can learn.
15. As a person navigating, I want each item to have exactly one primary location determined by its Parent, so that I always know where something lives.
16. As a person with relationships that cross topics, I want Cross-links shown without moving the item, so that the Tree stays legible while the graph stays truthful.
17. As a person reading the Tree, I want each kind distinguished by shape, icon, text label, and colour together, so that meaning never depends on colour alone.
18. As a person reading the Tree, I want Seeds as pods, Roots as outlined evidence nodes, Branches as labelled junctions, Claim Leaves as filled leaves, Question Leaves as open rings, Idea Leaves as buds, Observation Leaves as lens forms, and Harvests as golden markers, so that kind is recognizable at a glance.
19. As a person navigating, I want to pan, zoom, and select with the mouse, so that ordinary exploration feels direct.
20. As a keyboard-only person, I want to move through the Tree, select items, collapse Branches, and focus a Branch entirely from the keyboard, so that the interface is genuinely usable without a pointer.
21. As a screen-reader user, I want the Tree to expose semantic labels for every node and relationship, so that the structure is available to me as text.
22. As a person sensitive to motion, I want reduced-motion behavior honoured throughout the Tree, so that the interface does not make me unwell.
23. As a person with a large Garden, I want to collapse a Branch to bound what is drawn, so that the view stays responsive.
24. As a person working on one topic, I want to focus the Tree on a single Branch without altering any canonical relationship, so that focus is a view, not an edit.
25. As a person with a seasonal workflow, I want Dormant Branches to visually recede while remaining canonical, searchable, and focusable, so that setting work aside is not the same as archiving or deleting it.
26. As a person, I want reparenting to be an explicit proposed action rather than a drag gesture, so that I cannot restructure my knowledge by accident.
27. As a person, I want the Tree to remain a navigational projection rather than a folder browser, so that storage layout never dictates how I think about my research.

### Evidence tracing — the signature interaction

28. As a person selecting a Claim Leaf or Harvest, I want the Tree to soften unrelated regions and illuminate the complete path from Roots through supporting items to my selection, so that provenance becomes something I can see rather than something I have to reconstruct.
29. As a person tracing evidence, I want Contradicts relationships drawn as dashed mulberry paths, so that disagreement is visually distinct from support.
30. As a person tracing evidence, I want the right panel to open the selected item's content at the same time, so that structure and substance are legible together.
31. As a person tracing evidence, I want the illumination to clear when I select something else, so that the Tree does not accumulate visual debt.
32. As a person examining a Harvest, I want to reach every Root that supports it in one traversal, so that I can audit an accepted conclusion.

### Reading and editing items

33. As a person selecting any item, I want its Markdown rendered for reading by default, so that the Garden reads like a document rather than a form.
34. As a person who wants to change something, I want an explicit Edit mode that gives me the plain Markdown, so that I retain direct authorship over my own files.
35. As a person editing, I want raw HTML disabled and rendered output sanitized, so that a file in my folder cannot execute against the application.
36. As a person reading an item that references remote images or embeds, I want them left as visible links rather than fetched, so that opening a note does not silently announce my activity to a third party.
37. As a person reading an item with an Attachment, I want validated relative references within my Garden Repository to render, so that my own supporting files are usable.
38. As a person following an external link, I want it opened with isolation from the application context, so that a link in my notes cannot reach back into the app.
39. As a person reading a Root, I want its origin metadata, capture time, content hash, and exact captured excerpt, and no agent-authored summary, so that the evidence record stays evidence.
40. As a person reading a Harvest, I want its Question, Synthesis, Evidence, Contradictions and uncertainty, and Open questions sections always present, so that accepted conclusions stay traceable and unresolved conflict stays first-class.
41. As a person reading a Seed, I want its original captured body preserved verbatim regardless of what has since grown from it, so that provenance survives interpretation.
42. As a person reading a Cultivated Seed, I want to see the Roots, Branches, Leaves, and Harvests derived from it, so that I can follow a capture forward into what it became.
43. As a person capturing quickly, I want Seeds, Branches, and Leaves to require only a title and body without mandatory sections, so that ordinary thinking does not feel like filling in a form.
44. As a person who edits a file by hand outside Research Garden, I want my unknown frontmatter fields, comments, and untouched body text to survive read and write cycles, so that Research Garden is not the exclusive editor of my own files.
45. As a person, I want an edit to one known field to leave the rest of the file unnormalized, so that diffs stay small and reviewable.

### Diagnostics and resilience

46. As a person with one malformed file, I want the rest of my Garden to open normally, so that a single bad file cannot lock me out of my research.
47. As a person with a malformed file, I want a visible Garden Diagnostic explaining what needs attention, so that the problem is surfaced rather than hidden.
48. As a person with a malformed file, I want mutations targeting it blocked until it validates, so that a broken item cannot be made worse.
49. As a person, I want invalid files to remain visible to auditing rather than quarantined out of sight, so that I can find and fix them.
50. As a person, I want relationships referencing items that do not exist reported as Diagnostics rather than silently dropped, so that I learn about breakage.
51. As a person, I want the Garden rescanned when the window regains focus, when I press Refresh, and immediately before any consistency-sensitive action, so that I am acting on current files without continuous polling.
52. As a person who edited a file in another editor, I want Research Garden to notice at the next consistency boundary, so that the two views converge.

### Graph and schema integrity

53. As a person, I want every canonical item to carry a stable kind-prefixed identity in frontmatter, so that renaming a file never breaks my knowledge graph.
54. As a person, I want Markdown filenames to be readable title slugs, so that my folder is pleasant to browse without Research Garden.
55. As a person, I want a short identity suffix added to a filename only when needed to resolve a collision, so that filenames stay clean in the common case.
56. As a person, I want only Parent, Derived From, Supports, Answers, Contradicts, and Relates To recognized, so that an agent cannot fragment my graph by inventing synonyms.
57. As a person, I want self-links, duplicate relationships, and invalid kind pairings rejected, so that the graph stays coherent.
58. As a person, I want cycles in Parent placement rejected while non-parent Cross-links may form cycles, so that the Tree always has a valid projection without over-constraining the graph.
59. As a person, I want every Leaf and Harvest to require a Branch parent while Branches may be top-level or nested and Seeds and Roots need no parent, so that evidence can support knowledge across topics without being forced into one.
60. As a person, I want Claim Leaves and Harvests to require at least one supporting Root while Question, Idea, and Observation Leaves may stand unsourced, so that I can think freely without unsourced material posing as established knowledge.
61. As a person, I want Roots' captured evidence immutable after creation with only metadata correctable through an approved change, so that later reasoning cannot rewrite the evidence behind earlier conclusions.
62. As a person, I want Contradicts and Relates To treated as symmetric and Parent, Derived From, Supports, and Answers as directional, so that relationship semantics are predictable.
63. As a person, I want Claim Leaves and Harvests to record their evidence as an item-local reference to Roots, so that adding new knowledge never requires mutating an immutable Root.
64. As a person, I want inverse relationships derived during scanning rather than written into both files, so that every action stays within one file.
65. As a person, I want every canonical item to declare its schema version, so that files copied between Gardens or opened in another editor describe themselves.
66. As a person, I want a schema migration to require an exact preview and my approval rather than happening silently, so that version handling never becomes an unreviewed rewrite.
67. As a person, I want canonical timestamps serialized as ISO 8601 UTC with creation time stable for an item's lifetime, so that history does not drift with my timezone.

### Index, search, and performance

68. As a person opening a Garden, I want the in-memory Garden Index rebuilt from canonical Markdown, so that my files remain the only system of record.
69. As a person reopening a Garden, I want an optional derived Index Cache to speed the open, so that large Gardens are not slow every time.
70. As a person, I want the Index Cache verified against a schema version and a manifest of file metadata and content hashes, so that a stale cache can never masquerade as current state.
71. As a person, I want the entire cache invalidated on a schema mismatch or an uncertain manifest, so that partial trust never produces a wrong Garden.
72. As a person, I want to delete the cache at any time with no loss of canonical knowledge, so that the derived layer is genuinely disposable.
73. As a person, I want cache reuse never to weaken the Garden Revision or any pre-write consistency check, so that the speed optimization cannot become a safety hole.
74. As a person, I want search over my Garden that returns useful matches with snippets, so that I can find material without traversing the Tree.
75. As a person with a Garden of a thousand items and five thousand relationships, I want indexing and search to stay usable, so that the product survives a real research workload.
76. As a person exceeding that scale, I want a performance warning rather than a hard rejection or destructive behavior, so that the product degrades honestly.

### Change Tray, activity, and approval

77. As a person, I want the Change Tray to sit as a thin status rail when there is nothing to review, so that it does not permanently consume my workspace.
78. As a person, I want the tray to expand when a Pending Change appears, so that proposed mutations are continuously discoverable.
79. As a person, I want opening a Pending Change's diff not to obscure the Tree, so that I can review in context.
80. As a person, I want every Pending Change to show the exact one-file diff that would be written, so that approval means approving something specific.
81. As a person, I want Pending Changes persisted alongside my Garden so they survive a page reload and travel with the folder, so that review is not lost to a refresh.
82. As a person, I want persisted Pending Changes to remain plainly noncanonical, so that a proposal never becomes knowledge merely by existing on disk.
83. As a person, I want a Pending Change marked Stale when its target no longer matches the state its preview was built from, so that approving old work cannot overwrite newer work.
84. As a person, I want to reject a Pending Change explicitly, so that declining is a first-class outcome rather than abandonment.
85. As a person, I want a content-free Garden Activity feed showing action name, time, affected item IDs, and outcome, so that I can see what happened without the feed becoming a second copy of my content.
86. As a person, I want read activity to remain session-scoped and unpersisted, so that using the product does not accumulate a history file about me.
87. As a person, I want no analytics, behavioral tracking, or remote error payloads anywhere in the build, so that the privacy claim is structural rather than promised.

### Writing safely

88. As a person, I want low-risk additions to create one new canonical file directly, so that ordinary capture is not buried in approval ceremony.
89. As a person, I want edits, moves, relation creation, and Harvest materialization to require a preview and my explicit approval, so that changes to existing knowledge are always deliberate.
90. As a person, I want every Garden Action to touch at most one canonical Markdown file, so that previews, validation, and recovery stay predictable inside the browser filesystem boundary.
91. As a person, I want the previous content saved as an Undo Snapshot before any canonical file is replaced, so that recovery is always available.
92. As a person, I want each write performed once, then the file reread, revalidated, and hash-confirmed before success is reported, so that a browser acknowledgement alone never counts as completion.
93. As a person, I want every apply to revalidate folder permission, target hash, preview hash, one-file scope, schema, and graph invariants, so that nothing slips between preview and write.
94. As a person, I want to undo an applied change only while the current file still matches that change's resulting hash, so that recovery cannot silently destroy work done since.
95. As a person, I want undo to leave the resulting file record intact, so that recovery is itself an auditable event.
96. As a person with the application open in two tabs, I want a proposal built on another tab's obsolete state to become Stale rather than overwrite newer content, so that the absence of a coordination protocol is safe rather than lossy.
97. As a person, I want every action addressed by stable item ID rather than a file path, so that no action can be steered outside my Garden Repository.
98. As a person, I want canonical writes resolvable only to the typed Garden folders and operational writes only to the defined operational locations, so that path handling has no escape hatch.
99. As a person, I want no action to accept an absolute or caller-supplied filesystem path, so that the folder I selected is the true boundary.

### Enabling Agent Access

100. As a person opening a Garden, I want to start in human-only mode, so that connecting an agent is always an act rather than a default.
101. As a person, I want a visible Connect ChatGPT action, so that enabling Agent Access is discoverable when I want it.
102. As a person connecting, I want one clear disclosure explaining that selected metadata, snippets, and bodies may be returned to the browser agent, so that I consent to what actually happens.
103. As a person, I want the disclosure to avoid claiming my data never leaves the device, so that the product does not lie about its own defining workflow.
104. As a person who has read the disclosure, I want bounded read actions to proceed without repetitive per-call confirmation while remaining visible in Garden Activity, so that the workflow is usable without being opaque.
105. As a person, I want Agent Access scoped to the current browser session and never silently restored after reload, so that a remembered folder handle does not quietly re-enable an agent.
106. As a person, I want folder permission and Agent Access to be genuinely separate decisions, so that opening my files does not imply connecting an agent.
107. As a person, I want Disconnect ChatGPT to unregister the Garden tools immediately, so that revocation is instant rather than eventual.
108. As a person disconnecting, I want my existing Pending Changes to remain local and reviewable in the human interface, so that disconnecting does not destroy work in progress.
109. As a person disconnecting, I want to be told plainly that content already returned to the agent cannot be recalled, so that I understand the limits of revocation.

### The agent's view

110. As a browser agent encountering the site with no Garden open, I want only a description tool available, so that I can learn what Research Garden is without any filesystem-backed capability appearing usable.
111. As a browser agent, I want tools registered according to the current state — the open Garden, the selected item, the focused Branch, and whether Pending Changes exist — so that I see relevant capability instead of one permanently enormous surface.
112. As a browser agent, I want tool schemas to stay stable while irrelevant tools are unregistered, so that state-awareness reduces ambiguity without breaking my expectations.
113. As a browser agent, I want to inspect the Garden's shape and audit its Diagnostics, so that I can orient before acting.
114. As a browser agent, I want to search the Garden and receive bounded results with snippets, so that I can locate material without pulling everything into context.
115. As a browser agent, I want search to default to ten results and cap at twenty-five, so that one call cannot flood my context.
116. As a browser agent, I want to read full bodies only through an explicit read action limited to five identities with explicit truncation and continuation information, so that deliberate retrieval replaces silent bulk exposure.
117. As a browser agent, I want to explore a Branch, trace evidence, find open questions, and find contradictions, so that I can do genuine research rather than only file operations.
118. As a browser agent, I want to prepare a source comparison and prepare a Seed cultivation, so that multi-step reasoning has structured starting points.
119. As a browser agent, I want to plant a Seed and capture a Root by supplying title, origin URL, exact excerpt, and optional attribution, so that I can preserve what I browsed without Research Garden scraping anything itself.
120. As a browser agent, I want captured Root content persisted after validation and never summarized on my behalf, so that evidence stays exactly what I supplied.
121. As a browser agent, I want to add a Leaf, propose a relation, propose a move, and propose a Harvest, so that I can contribute structure and synthesis.
122. As a browser agent, I want to list and inspect Pending Changes, so that I can see the exact diff of what I proposed.
123. As a browser agent, I want the apply action registered only after I have inspected one exact diff, and to carry that change identity and preview hash, so that I cannot apply something I never opened.
124. As a browser agent, I want apply, reject, and undo each scoped to one identified change and subject to the host's user-confirmation flow, so that mutation always passes through a human.
125. As a browser agent, I want every tool to return a common envelope carrying success or a stable error code, structured data, the current Garden Revision, retryability, and warnings, so that I can reason about outcomes without parsing prose.
126. As a browser agent, I want explicit distinguishable errors for browser capability, permission, lookup, schema, relation, inspection, staleness, confirmation, and write failures, so that I can respond appropriately to each.
127. As a browser agent, I want non-mutating tools annotated read-only, so that I can reason about safety from the tool surface.
128. As a browser agent, I want any result carrying Seed, Root, Leaf, Harvest, URL, excerpt, or snippet content annotated as untrusted, so that instructions embedded in a user's files do not read as instructions from the user.
129. As a browser agent, I want the Garden Revision in every result, so that I can tell whether what I hold is still current.
130. As a browser agent, I want the same underlying behavior as the human interface, so that agent capability is substantive rather than a parallel reduced implementation.

### The complete loop

131. As a person, I want to select an empty folder, create a Sample Garden, connect ChatGPT, have it find a contradiction between two supported Claims, inspect its proposed Harvest, approve it, and find the resulting Markdown in my folder, so that the defining promise is demonstrable in one continuous session.
132. As a person, I want the resulting Harvest to preserve both contradictory Claims and their Roots rather than silently choosing a winner, so that the synthesis explains uncertainty instead of erasing it.
133. As a person, I want the resulting Markdown fully readable and editable without Research Garden, so that I am never locked in.
134. As a person, I want the Harvest's Answers relationship to connect it to the Question Leaf it addresses, so that inquiry and conclusion stay linked.

### Offline, deployment, and documentation

135. As a person who has loaded the app once, I want the versioned application shell cached so the human interface keeps working on a permitted folder without a network connection, so that my local work does not depend on connectivity.
136. As a person, I want Garden files and tool results never service-worker cached, so that the offline capability cannot become a shadow copy of my knowledge.
137. As a person evaluating the project, I want a public repository with the application, tests, design record, ADRs, Sample Garden material, an Apache-2.0 licence, a threat model, a full tool reference, a contribution guide, a roadmap, and known limitations, so that the safety and interoperability claims are inspectable outside a demo.
138. As a person evaluating the project, I want the documentation to describe the agent data flow precisely, so that I can judge the privacy model on its actual behavior.
139. As a maintainer, I want the deployed URL to pass real local-folder and WebMCP smoke tests before submission, so that a successful build is never mistaken for a working product.

## Implementation Decisions

### Shape

- Client-only React and TypeScript PWA on a Sites-compatible Vite build. No application data backend, no accounts, no server-side rendering (ADR 0002, 0048).
- One public repository with internal modules; not a monorepo, and documentation is not split out (ADR 0069).
- Dependency surface stays focused: a YAML document library, a runtime schema validator, a safe Markdown renderer, and a hierarchy-layout library. No note-editor framework, no graph-editor framework, and no reimplementation of mature parsers or sanitizers. Each dependency must serve a named product boundary (ADR 0051).

### Layering

The build separates four concerns, and this separation is what makes the test seams below meaningful:

- **Domain** — canonical item shapes, the relationship vocabulary, graph invariants, and the Garden Index. Pure, with no filesystem or browser dependency.
- **Filesystem port** — an adapter interface for directory access, read, write, and permission state, with a File System Access implementation and an in-memory implementation. Domain logic never touches the browser API directly.
- **Garden Action layer** — the single implementation of every meaningful operation on a Garden. Both the human interface and the WebMCP tools call this layer; neither reimplements behavior (ADR 0003). This is the architectural commitment that keeps agent capability substantive.
- **Presentation and tool surfaces** — the React workspace and the WebMCP registration layer, both thin over the Action layer.

### Garden Repository contract

- Canonical Markdown is organized by botanical type into per-kind directories, with attachments separate and rebuildable operational state under a dotted operational directory holding the Index Cache, Pending Change records, and Undo Snapshots (ADR 0011, 0026).
- Typed directories store files; frontmatter relationships determine the visible Tree. Storage layout is not the Tree (ADR 0008, 0011).
- Each canonical item carries a kind-prefixed ULID in frontmatter and a readable title-slug filename, with a short identity suffix appended only to resolve collisions (ADR 0034).
- Universal frontmatter carries schema version, id, kind, kind-specific fields, title, optional parent id, relations, and creation and update timestamps in ISO 8601 UTC (ADR 0020, 0076, 0077).
- Claim Leaves and Harvests serialize their evidence as an item-local reference to supporting Roots — the item-local inverse of the domain's Supports relationship — so growing knowledge never mutates immutable Root evidence (ADR 0020).
- Inverse relationships are derived during scanning, never written to a second file. This is what makes the one-file action boundary achievable (ADR 0021).
- New files use a documented canonical field order. Existing files are edited through a YAML document model that preserves unknown fields, comments, and untouched body text, and are not fully normalized because one known field changed (ADR 0054, 0078).
- Harvest bodies require Question, Synthesis, Evidence, Contradictions and uncertainty, and Open questions sections. Roots and Harvests are the only strongly templated kinds; Seeds, Branches, and Leaves stay lightweight (ADR 0030, 0032).
- Root evidence is immutable after creation; only Root metadata is correctable, and only through an approved change. A Root stores origin metadata, capture time, content hash, and the exact excerpt, and never an agent-authored summary (ADR 0012, 0029).

### Graph invariants

Enforced by the domain layer and applied both at index build and before every write:

- The recognized vocabulary is exactly Parent, Derived From, Supports, Answers, Contradicts, and Relates To (ADR 0017).
- Parent, Derived From, Supports, and Answers are directional. Contradicts and Relates To are symmetric Cross-links (ADR 0079).
- Self-links, duplicate relationships, and invalid source/target kind pairings are rejected (ADR 0079).
- Parent placement must be acyclic. Non-parent Cross-links may form cycles because they do not determine Tree placement (ADR 0079).
- Branches may be top-level or nested. Every Leaf and Harvest requires a Branch parent. Seeds and Roots require no parent and occupy their own strata (ADR 0028).
- Claim Leaves and Harvests require at least one supporting Root. Question, Idea, and Observation Leaves may be unsourced (ADR 0010).
- Contradictory supported Claims are both preserved along with their Roots and an explicit Contradicts relationship. Nothing is deleted because a conflict exists (ADR 0018).
- Cultivation never rewrites, moves, or replaces a Seed. Cultivated Seed status is derived from incoming Derived From relationships (ADR 0015).

### Index, revision, and cache

- Opening a Garden scans canonical Markdown into an in-memory Garden Index that supports the Tree, search, validation, and tool results but is never the source of truth (ADR 0050).
- A Garden Revision is a content-derived identity for the canonical Garden state, returned with every tool result and used to detect whether held results or proposals are still current.
- An invalid canonical file produces a Garden Diagnostic and does not prevent unrelated valid files from loading. Invalid items remain visible to auditing, and mutations targeting them are blocked until they validate (ADR 0052).
- The Index Cache records a schema version and a manifest of file metadata and content hashes. Unchanged entries may be reused and changed files reparsed; a schema mismatch or an uncertain manifest invalidates the whole cache. Cache reuse never substitutes for a pre-write consistency check (ADR 0062).
- Rescan happens on window focus, on explicit Refresh, and immediately before any consistency-sensitive action. There is no continuous folder polling (ADR 0053).

### Mutation pipeline

- Risk-scaled approval: low-risk additions create one new canonical file directly; edits, moves, relation creation, Harvest materialization, rejection, and undo go through identified Pending Changes or equivalent confirmed recovery records (ADR 0005).
- Every action creates or updates at most one canonical Markdown file and records an Undo Snapshot (ADR 0021).
- Pending Changes persist as noncanonical operational JSON so they survive reload and travel with the Garden Repository, without becoming knowledge (ADR 0026).
- A Pending Change becomes Stale whenever its recorded target state no longer matches. Stale changes are rejected, not force-applied (ADR 0025, 0063).
- Write sequence: revalidate directory permission, target content hash, preview hash, one-file scope, schema, and graph invariants; snapshot prior content; write once; reread; revalidate; confirm content hash; then report (ADR 0055).
- Undo is permitted only while the current file still matches the applied change's resulting hash (ADR 0027).
- Cross-tab writer coordination is deliberately absent. Hash comparison makes an obsolete proposal stale rather than lossy (ADR 0063).
- All actions address items by stable ID. Canonical writes resolve only to typed Garden directories; operational writes only to defined operational locations. No action accepts an absolute or caller-supplied path (ADR 0058).

### Agent interface contract

- Before a Garden is open and Agent Access is enabled, WebMCP exposes only the non-filesystem description tool. Opening a folder establishes browser permission but registers no filesystem-backed tools (ADR 0035).
- Connect registers tools in compact state-aware bundles determined by the open Garden, selected item, focused Branch, and presence of Pending Changes. Schemas stay stable while irrelevant tools are unregistered (ADR 0023).
- Core tools after connection: inspect, search, read items, audit, plant Seed, capture Root. Contextual research and proposal tools: explore Branch, trace evidence, find open questions, find contradictions, prepare source comparison, prepare Seed cultivation, add Leaf, propose relation, propose move, propose Harvest. Pending-change tools: list, inspect, apply, reject, undo.
- The apply tool is registered only after the inspect tool has opened one exact diff, and the apply request carries that change identity and preview hash. Tool availability and host confirmation never substitute for application-enforced revalidation (ADR 0024, 0025).
- Common result envelope on every tool: success or a stable error code, structured data, current Garden Revision, retryability, and warnings. The error contract begins with browser, permission, lookup, schema, relation, inspection, staleness, confirmation, and write failures. No prose-only or exception-driven control flow (ADR 0036).
- Non-mutating tools declare read-only. Any result carrying Seed, Root, Leaf, Harvest, URL, excerpt, or search-snippet content declares untrusted content (ADR 0037).
- Bounded reads: search defaults to ten and caps at twenty-five; read items accepts at most five identities and reports explicit truncation and continuation (ADR 0038).
- Progressive exposure: inspection and search return metadata and short snippets only; full bodies reach the agent only through the explicit read action, which is visibly recorded (ADR 0022).
- Root content is supplied by the agent and validated and persisted by Research Garden. The PWA does not fetch or scrape webpages (ADR 0033).
- Agent Access is session-scoped and never silently restored after reload, even with a remembered directory handle. Disconnect aborts registered tools immediately, leaves Pending Changes intact, and states that already-returned content cannot be recalled (ADR 0081, 0083).
- One disclosure at connect time covers bounded reads; after it, read tools do not require repetitive application-level confirmation but remain visible in Garden Activity. Mutations keep their separate preview and confirmation rules (ADR 0082).

### Workspace and visual system

- Desktop-first workspace: a slim folder and Agent Access bar; the Tree across roughly two-thirds; a selected-item panel; an adaptive bottom Change Tray; and a content-free Garden Activity feed (ADR 0019, 0040, 0047).
- Before a Garden exists, a bare trunk with Create Garden and Open Garden at the soil line (ADR 0046).
- The Tree is purpose-built accessible SVG with semantic labels and keyboard interaction. The hierarchy library computes layout and paths only; it owns no application state and imposes no generic graph-editor model (ADR 0049).
- Tree interactions: pan, zoom, select, collapse a Branch, focus a Branch, keyboard navigation, reduced motion. No drag-to-reparent, no free positioning (ADR 0042).
- Botanical form is retained but subordinated to work: recognizable trunk, roots, limbs, restrained foliage, with knowledge nodes dominant (ADR 0043).
- Kind is encoded by shape, icon, text label, and colour together, never by colour alone (ADR 0044).
- Selection illuminates the complete provenance and evidence path and softens unrelated regions; Contradicts paths are dashed mulberry (ADR 0045).
- Botanical Instrument palette; Literata for reading and titles, Instrument Sans for controls, IBM Plex Mono for metadata and activity (ADR 0039).
- Items render as sanitized Markdown with raw HTML disabled; an explicit Edit mode swaps to plain Markdown editing (ADR 0041, 0056).
- Remote images and embeds are never auto-fetched and remain links; validated relative Attachments within the Garden Repository may render (ADR 0057).

### Capability, storage, and privacy

- Local-folder access and WebMCP are feature-detected independently. With folder access alone the complete human interface works; agent workflows require both. Unsupported environments get a capability-specific explanation, never a partially executed action (ADR 0059).
- Browser-local storage holds only the Garden directory handle and display name, never canonical content, and file permission is re-requested whenever the browser requires it (ADR 0060).
- Garden Activity records action name, time, affected item IDs, and outcome, with no raw bodies or tool results. Read activity is session-scoped; only Pending Change and Undo Snapshot records persist (ADR 0067).
- The service worker caches only versioned application assets and never Garden files or tool results (ADR 0072).
- No analytics, behavioral tracking, remote error payloads, or content telemetry. Documentation distinguishes this from ordinary hosting request logs (ADR 0073).
- Documentation states that files remain local until a person enables Agent Access and a bounded action returns selected content, and never claims data never leaves the device (ADR 0080).

### Performance

- The performance fixture is a generated Garden of 1,000 items and 5,000 relationships. Indexing and search must remain usable against it. Collapse and focus bound the visible SVG workload. Larger repositories receive a warning rather than a hard limit (ADR 0061).

## Testing Decisions

### What makes a good test here

A good test states an external behavior of the layer under test and would still pass after that layer is rewritten. It drives the layer through its public interface with real inputs, and asserts on observable results — the Diagnostic produced, the envelope returned, the bytes written, the node the keyboard reached. It does not assert on internal call sequences, private helpers, or module structure.

The one place this discipline is easy to lose is the domain layer, where the temptation is to test private parsing helpers. Every domain test goes through the layer's public surface: parse a document, build an index, validate a proposed mutation.

### Seams

This spec uses per-layer seams — the deliberate choice is that each layer below is independently testable, accepting more surface area than a single top-level seam in exchange for pinning the invariants that carry the product's safety claims. The Garden Action layer is the primary *behavioral* seam; the layers beneath it are tested for invariants rather than for user-visible flows.

1. **Document model seam.** Parse canonical Markdown into a document model and serialize it back. Behaviors: unknown frontmatter fields, comments, and untouched body text survive a round trip; new files emit the canonical field order; an edit to one known field leaves the rest of the file unnormalized.
2. **Schema validation seam.** Validate a candidate item. Behaviors: known field types and invariants enforced per kind; unknown fields retained rather than rejected; schema version handling; required Harvest sections; Root immutability rules; UTC timestamp serialization.
3. **Graph invariant seam.** Validate relationships and placement over a set of items. Behaviors: vocabulary enforcement; directional versus symmetric handling; rejection of self-links, duplicates, and invalid kind pairings; Parent acyclicity with permitted Cross-link cycles; parentage-by-kind; the Claim and Harvest evidence requirement.
4. **Index build seam.** Build a Garden Index from a set of documents. Behaviors: Tree projection from frontmatter; derived inverse relationships; derived Cultivated Seed status; Garden Revision derivation and stability; Diagnostic production with unrelated items still loading; mutations blocked against invalid items; search result shape, snippet content, default of ten, and cap of twenty-five.
5. **Index Cache seam.** Load and persist a cache. Behaviors: manifest-verified reuse of unchanged entries; reparse of changed files; total invalidation on schema mismatch or uncertain manifest; deletion leaving canonical knowledge intact; cache reuse never altering the Garden Revision.
6. **Filesystem port seam.** One contract suite run against both the in-memory adapter and the File System Access adapter. Behaviors: directory scan, read, single write, reread, permission state, and permission loss mid-operation. This is the seam that keeps the in-memory adapter honest; per ADR 0064, the File System Access run belongs to the manual and real-browser acceptance pass rather than the deterministic unit run.
7. **Garden Action seam.** The primary behavioral seam, exercised over the in-memory adapter. Behaviors: Create Garden materializing a Sample Garden into an empty folder and refusing a conflicting one; Open Garden scanning an existing repository; every action touching at most one canonical file; direct application of low-risk additions; Pending Change creation with an exact one-file preview; staleness on a changed target; the full revalidate-snapshot-write-reread-verify sequence; undo permitted only against a matching result hash; ID-only addressing with no path escape; rescan at consistency boundaries.
8. **WebMCP tool seam.** A direct harness invoking registered tools without a live agent host. Behaviors: only the description tool before a Garden is open and Agent Access enabled; state-aware registration and unregistration; stable schemas across bundles; the common result envelope including Garden Revision, retryability, and warnings; each named error code; read-only and untrusted-content annotations on the correct tools; read bounds and continuation; apply registered only after inspect and carrying the preview hash; immediate unregistration on disconnect with Pending Changes preserved.
9. **Human interface seam.** Playwright over the real workspace against a fixture folder. Behaviors: the bare-trunk entry; folder selection; the Tree's pan, zoom, select, collapse, and focus; full keyboard navigation and reduced motion; the evidence-tracing illumination and dashed Contradicts paths; read-then-edit mode switching; the Change Tray's empty, expanded, and diff states; approval and rejection; the content-free Activity feed; the capability-specific explanations for unsupported environments; and sanitized rendering with remote media left unfetched.

Seams 1–5 and 7 run under Vitest with no browser. Seam 6 runs the in-memory half under Vitest and the real half in the browser acceptance pass. Seam 8 runs under Vitest against the registration layer. Seam 9 runs under Playwright (ADR 0065).

### Prior art

There is none — this is the first implementation in the repository. These seams therefore establish the pattern, and later work should extend them rather than introduce parallel testing styles.

### Risk-bearing acceptance scenarios

Submission readiness requires all of these to pass, and a happy-path recording is explicitly not release evidence (ADR 0066):

- Sample Garden creation into a real empty folder
- The complete contradiction-to-Harvest flow
- Invalid-file isolation
- Stale-change rejection
- Safe undo
- Permission loss mid-session
- Malicious Markdown and remote-media handling
- The 1,000-item, 5,000-relation performance fixture

Plus, per ADR 0064 and 0068, at least one manual run using a real selected folder in a current supported desktop Chromium environment, and the deployed URL's complete WebMCP workflow in ChatGPT's supported desktop environment. Real File System Access and WebMCP smoke tests must pass against the deployed URL before submission; a successful build or page render is insufficient.

## Out of Scope

From the design record's explicit non-goals: accounts, hosted sync, collaboration, or a backend knowledge store; an embedded model, model-provider setup, or API-key flow; semantic embeddings or a vector database; arbitrary web scraping by the PWA; rich block editing, free-form graph layout, or drag-to-reparent; mobile editing; bulk import, deletion, pruning, multi-file refactors, or automatic schema migrations; and broad cross-browser or multi-tab editing guarantees.

Also out of scope for this spec:

- **Deletion and pruning of any kind.** No tool and no human action removes a canonical item.
- **Multi-file transactions.** The one-file boundary is a hard constraint, not a starting simplification.
- **Cross-tab writer coordination.** Deferred to post-challenge; staleness detection covers the safety case (ADR 0063).
- **Designing for 100,000 items.** The target is the 1,000-item fixture with honest degradation above it (ADR 0061).
- **Second-model integration.** All semantic reasoning belongs to the browser agent (ADR 0007).
- **Exhaustive testing of cosmetic states** (ADR 0066).
- **The submission video, the deployed Sites configuration, and the public repository documentation set.** These are real deliverables under ADR 0068, 0070, 0074, and 0075, but they are release activities rather than implementation issues under this spec.

## Further Notes

**On scope.** This spec covers the full MVP as one effort. It is deliberately large and expects decomposition into implementation issues under this feature directory. A workable ordering is: filesystem port and document model, then schema and graph invariants, then index and cache, then the Garden Action layer, then the workspace, then WebMCP registration, then the acceptance scenarios. The Action layer is the pivot — nothing above it should be built until it exists, because both surfaces above it must call it rather than reimplement it.

**On the one-file boundary.** Several decisions that look independent are actually the same decision viewed from different angles: item-local evidence references, scan-derived inverse relationships, one-file actions, exact one-file previews, and per-file Undo Snapshots. Weakening any one of them breaks the others. Treat the one-file rule as load-bearing.

**On the ADR frontier.** The design record states its frontier is empty and every decision is confirmed. Per `docs/agents/domain.md`, any discovery during implementation that conflicts with an ADR or the design record must be surfaced as an explicit design change, not absorbed silently.

**On vocabulary.** `CONTEXT.md` lists rejected synonyms for every canonical term. Code identifiers, UI copy, tool names, error codes, and documentation should all use the canonical terms. If implementation needs a concept the glossary lacks, flag the domain gap rather than inventing a term.

**On the honesty constraint.** ADR 0080 forbids claiming that data never leaves the device, and ADR 0083 requires stating that returned content cannot be recalled. These are product-copy requirements, not just documentation ones — the disclosure and disconnect surfaces must say these things.
