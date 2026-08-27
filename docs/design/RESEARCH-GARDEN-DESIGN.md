# Research Garden — confirmed shared understanding

Confirmed by Tony on 2026-08-27.

## Product promise

Research Garden is a safe, local-first research interface where ChatGPT cultivates private Markdown through constrained, reviewable WebMCP tools. A person owns the Garden Repository, can use the complete human interface without an account, and decides when Agent Access is enabled.

The challenge build proves one unusual interaction: a public website can help a browser agent work usefully with private local knowledge without becoming the knowledge host or granting open-ended filesystem authority.

## Defining workflow

1. A person opens the public PWA and selects **Create Garden** or **Open Garden**.
2. Create Garden materializes a real Sample Garden in the selected empty folder; Open Garden scans an existing compatible repository.
3. The human Tree, item reader/editor, and Change Tray work without ChatGPT.
4. The person chooses **Connect ChatGPT**, sees the disclosure, and enables Agent Access for this session.
5. ChatGPT inspects the Garden, follows evidence, compares Claims, finds a contradiction, and proposes a Harvest.
6. Research Garden materializes an exact one-file Pending Change.
7. The person or confirmed agent flow inspects the exact diff and explicitly approves it.
8. Research Garden revalidates state, snapshots the prior content when applicable, writes once, rereads, validates, hashes, and reports the result.
9. The resulting Markdown remains in the user's local folder and is usable without Research Garden.

## Knowledge model

| Kind | Meaning | Primary constraint |
| --- | --- | --- |
| Seed | Preserved original capture before interpretation | Never rewritten by cultivation |
| Root | Preserved evidence or source record | Supports Claims and Harvests |
| Branch | Durable topic or research area | May be top-level, nested, active, or dormant |
| Claim Leaf | Source-backed atomic assertion | Requires at least one Root |
| Question Leaf | One unresolved inquiry | May be unsourced |
| Idea Leaf | Speculative explanation, possibility, or action | May be unsourced |
| Observation Leaf | Explicitly subjective or provisional notice | May be unsourced |
| Harvest | Structured synthesis from Roots and Leaves | Canonical only after approval |

Every item has one Parent placement where its kind permits it. Cross-links preserve graph relationships without turning the Tree into free-form node positioning.

Canonical relations are Parent, Derived From, Supports, Answers, Contradicts, and Relates To. Parent, Derived From, Supports, and Answers are directional. Contradicts and Relates To are symmetric. Self-links, duplicates, invalid kind pairings, and Parent cycles are rejected.

Contradictory supported Claims remain present. A Harvest explains the uncertainty instead of silently choosing a winner.

## Garden Repository

```text
garden/
├── seeds/
├── roots/
├── branches/
├── leaves/
├── harvests/
├── attachments/
└── .research-garden/
    ├── index.json
    ├── pending/
    └── undo/
```

Typed folders store files; frontmatter relationships determine the visible Tree. Markdown is canonical. `.research-garden/index.json` is an optional disposable Index Cache. Pending Change and Undo Snapshot records are operational JSON, not competing knowledge records.

Each canonical item uses a kind-prefixed ULID, a readable title-slug filename, and a short ID suffix only when needed to avoid collision. Universal frontmatter includes `schema_version`, `id`, `kind`, kind-specific fields, `title`, optional `parent_id`, `relations`, `created_at`, and `updated_at`. Timestamps use ISO 8601 UTC.

Existing files are edited through a YAML document model so unknown fields, comments, and untouched body text survive. New files use a canonical field order. Claims and Harvests serialize `supported_by` references so adding knowledge does not mutate Roots merely to maintain inverse links.

Harvest bodies contain these required sections:

- Question
- Synthesis
- Evidence
- Contradictions and uncertainty
- Open questions

## Tree and workspace

The permanent Tree is a navigational projection, not a folder browser or unconstrained graph editor. A custom accessible SVG uses D3 only for hierarchy and path calculations. People can pan, zoom, select, navigate by keyboard, collapse a Branch, or focus on one Branch. Reparenting is an explicit proposed action, never drag-and-drop.

The desktop workspace contains:

- a slim folder and Agent Access bar;
- the Tree across roughly two-thirds of the workspace;
- a selected-item panel rendering safe Markdown with an explicit plain-text Edit mode;
- an adaptive bottom Change Tray; and
- a content-free Garden Activity feed showing action, time, affected IDs, and outcome.

The signature interaction illuminates the complete provenance and evidence path from Roots through Claims to the selected Harvest. Contradictions use a dashed mulberry path. Kind is never conveyed by colour alone; shape, icon, label, and colour work together.

The visual reference is [research-garden-concept-v2.png](./research-garden-concept-v2.png). The system uses the Botanical Instrument palette, Literata for reading and titles, Instrument Sans for controls, and IBM Plex Mono for metadata and activity.

## Agent interface

Before a Garden is connected, WebMCP exposes only `describe_research_garden`. Connect ChatGPT dynamically registers tools appropriate to the current state and Disconnect ChatGPT aborts them immediately.

Core tools after connection:

- `inspect_garden`
- `search_garden`
- `read_items`
- `audit_garden`
- `plant_seed`
- `capture_root`

Contextual research and proposal tools:

- `explore_branch`
- `trace_evidence`
- `find_open_questions`
- `find_contradictions`
- `prepare_source_comparison`
- `prepare_seed_cultivation`
- `add_leaf`
- `propose_relation`
- `propose_move`
- `propose_harvest`

Pending-change tools:

- `list_pending_changes`
- `inspect_pending_change`
- `apply_pending_change`
- `reject_pending_change`
- `undo_change`

Tool registration is state-aware so ChatGPT sees useful current capabilities instead of one permanently enormous surface. The challenge MVP excludes deletion, pruning, bulk import, regeneration, multi-file refactors, wallets, accounts, hosted models, and arbitrary file paths.

Read tools use `readOnlyHint`; results containing user content use `untrustedContentHint`. Search returns 10 results by default and at most 25. `read_items` accepts at most five IDs and uses truncation plus continuation. Tools return a common result envelope with `ok`, structured `data`, `garden_revision`, and `warnings`, or a stable structured error.

## Permission and mutation model

Folder permission and Agent Access are separate decisions. A folder opens in human-only mode. Connecting ChatGPT discloses that bounded tool results may send selected local content to the agent. Reads then run without repetitive prompts but remain visible in Garden Activity.

Low-risk additions create one new canonical file directly. Edits, moves, relations, Harvest approval, rejection, and undo operate through identified Pending Changes or equivalent confirmed recovery records. An agent can apply a Pending Change only after `inspect_pending_change` has opened the exact diff and the host confirms it.

Every apply revalidates directory permission, target hash, preview hash, one-file scope, schema, and graph invariants. A changed target makes the proposal stale. Undo is permitted only while the current file still matches the applied result hash.

Tools accept stable item IDs. Canonical writes resolve only to typed Garden folders, and operational writes resolve only to defined `.research-garden/` locations. No tool accepts an absolute or user-controlled filesystem path.

## Content and browser safety

- Raw HTML in Markdown is disabled and rendered Markdown is sanitized.
- Remote images and embeds are not fetched automatically; remote URLs remain links.
- Validated relative Attachments may render from the selected Garden Repository.
- Invalid files become visible Garden Diagnostics while unrelated valid files continue loading.
- Mutations targeting an invalid item are blocked.
- The Garden is rescanned on focus, explicit Refresh, and before consistency-sensitive actions.
- The application shell may be cached offline; Garden content and tool results are never service-worker cached.
- The challenge build includes no product analytics or content telemetry.

Research Garden must not claim that data never leaves the device. Files remain local until the person enables Agent Access and a bounded action returns selected content to ChatGPT. Disconnecting unregisters tools but cannot recall content already returned.

## Technical shape

- React, TypeScript, and a ChatGPT Sites-compatible Vite build
- client-only application behavior with no login or application data backend
- File System Access adapter separated from domain logic
- in-memory Garden Index rebuilt from canonical Markdown
- optional schema-versioned and hash-verified Index Cache
- focused libraries for YAML documents, schema validation, sanitized Markdown, and hierarchy layout
- custom SVG Tree rather than a generic graph editor

The challenge performance fixture contains 1,000 items and 5,000 relations. Indexing and search must remain usable; focus and collapse bound the visible SVG. Larger Gardens receive warnings rather than hard rejection.

## Acceptance evidence

Automated evidence includes domain/schema tests, deterministic in-memory filesystem integration tests, Playwright human flows, and a direct WebMCP tool harness. Manual evidence includes a real selected folder and the deployed ChatGPT Sites URL in ChatGPT's supported desktop environment.

Required scenarios are:

- Sample Garden creation;
- the complete contradiction-to-Harvest flow;
- invalid-file isolation;
- stale-change rejection;
- safe undo;
- permission loss;
- malicious Markdown and remote-media handling; and
- the 1,000-item performance fixture.

## Challenge submission

The public GitHub repository contains the app, tests, this design record, ADRs, Sample Garden material, Apache-2.0 licence, threat model, tool reference, contribution guide, roadmap, and known limitations. The app is publicly deployed with ChatGPT Sites only after the real File System Access and WebMCP smoke tests pass.

The video is a single live cultivation loop under three minutes: create real files in an empty folder, have ChatGPT inspect evidence and expose a contradiction, inspect and approve its proposed Harvest, then show the resulting local Markdown.

## Explicit non-goals for the challenge MVP

- accounts, hosted sync, collaboration, or a backend knowledge store;
- an embedded model, model-provider setup, or API-key flow;
- semantic embeddings or a vector database;
- arbitrary web scraping by the PWA;
- rich block editing, free-form graph layout, or drag-to-reparent;
- mobile editing;
- bulk import, delete, pruning, multi-file refactors, or automatic schema migrations; and
- broad cross-browser or multi-tab editing guarantees.

## Frontier status

The design frontier is empty and this shared understanding is confirmed. No product, domain, security, interface, WebMCP, storage, validation, deployment, or challenge-submission decision identified during the grill remains silently assumed. Later discoveries that conflict with this document must be surfaced as explicit design changes rather than silently absorbed during implementation.
