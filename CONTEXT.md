# Research Garden

Research Garden is a local-first workspace for turning accumulated material into source-backed understanding. Its public web interface operates on canonical Markdown and evidence owned by the user in a selected local folder.

## Language

**Garden**:
The complete research workspace: its user-owned files, derived structure, interface, and agent-accessible actions.
_Avoid_: Vault, second brain, knowledge base

**Garden Repository**:
The local folder selected by the user that contains the Garden's canonical Markdown and source files.
_Avoid_: Vault, workspace folder, database

**Research Garden**:
The public web application through which a person or browser agent works with a Garden.
_Avoid_: Garden Repository, vault

**Garden Action**:
A meaningful operation on a Garden that is available through both the human interface and the WebMCP agent interface.
_Avoid_: Agent command, UI action, tool call

**Tree**:
The permanent navigational projection of a Garden's knowledge relationships. It gives each item one primary location without denying relationships elsewhere and can focus on one Branch without changing canonical relationships.
_Avoid_: Folder tree, knowledge graph, file browser

**Cross-link**:
An explicit relationship between items outside their primary placement in the Tree.
_Avoid_: Graft, backlink, secondary parent

**Sample Garden**:
A small starter Garden materialized as real files in a newly selected Garden Repository.
_Avoid_: Browser demo, fixture, temporary Garden

**Attachment**:
A user-owned noncanonical-supporting file stored under `attachments/` and referenced through a validated relative link from a Garden item.
_Avoid_: Remote embed, uploaded asset, source record

## Knowledge

**Seed**:
A preserved original capture that enters the Garden before interpretation or placement. It remains a Seed after cultivation so later knowledge retains its provenance.
_Avoid_: Inbox item, draft, raw note

**Cultivated Seed**:
A Seed that has produced one or more Roots, Branches, Leaves, or Harvests and links to those results.
_Avoid_: Archived Seed, processed note

**Root**:
A preserved source or evidence record from which supported knowledge can grow.
_Avoid_: Source, reference, attachment

**Branch**:
A durable topic or research area that organizes related knowledge.
_Avoid_: Folder, category, project

**Dormant Branch**:
A Branch intentionally receded from the active Tree while remaining canonical, searchable, and available for focused exploration.
_Avoid_: Archived Branch, deleted topic

**Leaf**:
One atomic thought typed as a claim, question, idea, or observation.
_Avoid_: Note, page, card

**Claim Leaf**:
A source-backed assertion supported by at least one Root.
_Avoid_: Fact, finding, statement

**Question Leaf**:
One unresolved inquiry.
_Avoid_: Prompt, research topic

**Idea Leaf**:
A speculative explanation, possibility, or proposed action.
_Avoid_: Claim, suggestion

**Observation Leaf**:
Something noticed and explicitly presented as subjective or provisional rather than established fact.
_Avoid_: Claim, evidence

**Harvest**:
A synthesis produced from one or more Roots and Leaves that becomes canonical only after explicit human approval.
_Avoid_: Summary, report, output

## Relationships

**Parent**:
The relationship that gives an item its one primary placement in the Tree.
_Avoid_: Folder, container

**Derived From**:
The provenance relationship from cultivated knowledge back to the Seed that prompted it.
_Avoid_: Created by, generated from

**Supports**:
The evidentiary relationship from a Root to a Claim Leaf or Harvest.
_Avoid_: Proves, confirms

**Answers**:
The relationship from a Harvest to a Question Leaf it addresses.
_Avoid_: Resolves, closes

**Contradicts**:
The relationship between Claim Leaves that make incompatible assertions. Neither Claim is discarded merely because this relationship exists.
_Avoid_: Replaces, disproves

**Relates To**:
A Cross-link used when no more precise canonical relationship applies.
_Avoid_: Associated with, connected to

**Pending Change**:
A proposed mutation to canonical Garden files awaiting human approval.
_Avoid_: Draft, suggestion, patch

**Stale Change**:
A Pending Change whose target no longer matches the state from which its preview was produced and therefore cannot be applied.
_Avoid_: Conflict, expired change

**Undo Snapshot**:
A recoverable record of one applied file change that can restore the prior content while the resulting file remains unchanged.
_Avoid_: Backup, version, history entry

**Garden Revision**:
A content-derived identity for the canonical Garden state used to detect whether tool results or proposed changes are still current.
_Avoid_: Release, app version, timestamp

**Garden Index**:
The rebuildable in-memory representation produced by scanning canonical Garden files. It supports the Tree, search, validation, and WebMCP tools but never becomes the source of truth.
_Avoid_: Database, canonical index, knowledge store

**Index Cache**:
An optional derived `.research-garden/index.json` snapshot used to accelerate opening a Garden. It may be deleted or rebuilt without losing canonical knowledge.
_Avoid_: Database, repository, backup

**Garden Diagnostic**:
A noncanonical validation finding about a Garden file or relationship. A Diagnostic explains what requires attention without silently discarding the affected item or preventing unrelated valid items from loading.
_Avoid_: Error file, broken note, pending change

**Garden Activity**:
A session-visible record that a Garden Action occurred, identified by action name, time, affected item IDs, and outcome without retaining raw private content.
_Avoid_: Audit log, chat history, file history

**Agent Access**:
The explicitly enabled, session-scoped connection that registers Garden tools for ChatGPT and permits bounded Garden content to be returned through WebMCP actions.
_Avoid_: Login, folder permission, account connection
