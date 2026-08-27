# Map: MVP cultivation loop

Spec: `spec.md`
Tickets: `issues/`
Triage: every ticket is `ready-for-agent`

The **frontier** is the first open, unblocked, unclaimed ticket. Ticket 01 has no
blockers; everything else waits on the edges below. Claim a ticket by setting
`Status: claimed` in its file.

## Dependency edges

| # | Ticket | Blocked by |
| --- | --- | --- |
| 01 | Application shell, capability gates, and the bare trunk | — |
| 02 | Open Garden tracer — folder to Tree to reader | 01 |
| 03 | Full canonical item schema across all eight kinds | 02 |
| 04 | Relationships, graph invariants, and Tree projection | 03 |
| 05 | Garden Diagnostics and invalid-file isolation | 04 |
| 06 | Create Garden and the Sample Garden | 04 |
| 07 | Content safety — sanitization, remote media, Attachments, link isolation | 03 |
| 08 | Tree navigation, focus, collapse, dormancy, and accessibility | 04 |
| 09 | Evidence tracing signature interaction | 08 |
| 10 | Botanical Instrument visual system | 09 |
| 11 | Search over the Garden Index | 04 |
| 12 | Human edit with verified write, Undo Snapshot, and Activity feed | 05 |
| 13 | Rescan at consistency boundaries | 12 |
| 14 | Pending Change lifecycle and Change Tray | 13 |
| 15 | Index Cache | 12 |
| 16 | PWA offline application shell | 06 |
| 17 | Agent Access gate — description tool, Connect, disclosure, Disconnect | 14 |
| 18 | Core read tools, result envelope, annotations, and bounded reads | 11, 17 |
| 19 | State-aware tool registration bundles | 18 |
| 20 | Direct-addition agent tools — plant Seed, capture Root, add Leaf | 18 |
| 21 | Agent research tools | 19 |
| 22 | Agent proposal tools | 19, 20 |
| 23 | Agent pending-change tools with inspect-gated apply | 22 |
| 24 | Performance fixture at 1,000 items and 5,000 relations | 11, 15 |
| 25 | Risk-bearing acceptance scenarios and the complete cultivation loop | 07, 16, 23, 24 |

## Parallel work

01 → 02 → 03 → 04 is a strict chain; nothing else can start until 04 lands.

After 04 the graph opens into five independent tracks that can be worked
concurrently:

- **Diagnostics and mutation**: 05 → 12 → { 13 → 14 → 17 → 18 …, 15 }
- **Sample Garden and offline**: 06 → 16
- **Content safety**: 07
- **Tree and visual**: 08 → 09 → 10
- **Search**: 11

The agent surface (17–23) is a single chain because each layer of the tool
contract depends on the one beneath it, except that 20 and 21 can run
concurrently once their blockers clear.

25 is the join point for everything.

## Notes

- **The critical path** to the defining demo runs 01 → 02 → 03 → 04 → 05 → 12 →
  13 → 14 → 17 → 18 → 19 → 20 → 22 → 23. Anything not on that path can slip
  without delaying the loop.
- **12 is the pivot.** It is the first write and it establishes the verified
  write sequence, Undo Snapshots, and the Activity feed. Every later mutation —
  human or agent — reuses it. Do not let a second write path grow beside it.
- **18 establishes the contract** that 19–23 all conform to: the result
  envelope, the error codes, and the read/untrusted annotations. Getting it
  wrong is expensive to correct later.
- **The one-file rule is load-bearing.** Item-local evidence references,
  scan-derived inverses, one-file actions, one-file previews, and per-file Undo
  Snapshots are the same decision seen from five angles. Weakening any one
  breaks the rest.
- Deliberately not ticketed, per the spec's Out of Scope: the submission video,
  the ChatGPT Sites deployment configuration, and the public repository
  documentation set. They are real deliverables under ADRs 0068, 0070, 0074,
  and 0075, but they are release activities rather than implementation work.
