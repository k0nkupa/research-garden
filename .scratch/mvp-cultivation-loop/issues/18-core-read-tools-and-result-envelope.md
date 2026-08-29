# 18: Core read tools, result envelope, annotations, and bounded reads

**What to build:** A connected browser agent can orient itself in a Garden and retrieve what it needs to reason, without one call silently consuming the whole Garden or its own context. Every result arrives in a predictable envelope carrying the current Garden Revision, so the agent can tell whether what it holds is still true, and stable error codes, so it can respond to a stale proposal differently from a lost permission. Content that came out of the person's files is marked untrusted, because instructions embedded in a note are not instructions from the person.

**Blocked by:** 11, 17

**Status:** resolved

- [x] Inspect, search, read items, and audit tools are registered after Agent Access is enabled
- [x] Every tool returns a common envelope carrying success or a stable error code, structured data, the current Garden Revision, retryability, and warnings
- [x] The error contract includes distinguishable browser, permission, lookup, schema, relation, inspection, staleness, confirmation, and write failures
- [x] No tool signals outcome through prose alone or through an uncaught exception
- [x] Non-mutating tools declare themselves read-only
- [x] Any result carrying Seed, Root, Leaf, Harvest, URL, excerpt, or search-snippet content declares untrusted content
- [x] Inspection and search return metadata and short snippets only, never full bodies
- [x] Search defaults to ten results and caps at twenty-five
- [x] Read items accepts at most five stable item IDs
- [x] Read items reports explicit truncation and continuation information for bounded bodies
- [x] Audit exposes Garden Diagnostics including invalid items
- [x] Tools accept stable item IDs and never a caller-supplied filesystem path
- [x] Every tool invocation appears in the Garden Activity feed as action, time, affected item IDs, and outcome, without raw content
- [x] The tools call the same underlying behaviour as the human interface rather than reimplementing it

## Notes

Built four tools (`inspect_garden`, `search_garden`, `read_items`, `audit_garden`) as pure
functions over the `GardenIndex` `Workspace` already holds in memory -- the same one the Tree
renders from -- rather than touching the filesystem directly. This follows the same rescan
discipline ADR 0053 already established (window focus, explicit Refresh, before a mutation;
never per-call), and means these four tools have no plausible `browser`/`permission`/`staleness`
path of their own -- see the caveat below. `search_garden` wraps `searchGardenIndex` (ticket 11)
directly; `audit_garden` wraps `index.diagnostics` directly -- neither reimplements anything
(ADR 0003).

A shared envelope (`src/webmcp/envelope.ts`) and a shared `createReadTool` factory
(`src/webmcp/readTool.ts`) turn each tool's own pure `run` function into a real
`ModelContextTool`: validating raw WebMCP input against a zod schema (whose JSON Schema is
derived via `z.toJSONSchema`, not hand-duplicated), recording exactly one Garden Activity entry
per call, and guaranteeing `execute` never throws even if `run` has a bug. All four tools share
this one wrapper rather than repeating it. Registration itself is wired into `Workspace.tsx` as
one `useEffect` keyed on the existing `agentAccess` flag from ticket 17 -- a simple on/off gate,
not the finer-grained state-aware bundle mechanism ticket 19 owns.

**Scope boundary, honestly caveated:** the error contract (`EnvelopeErrorCode`) defines all nine
codes ADR 0036 names, plus `invalid-input` (see below) and `internal` (a defensive fallback for a
bug in a tool's own logic). But these four *read* tools, being pure in-memory functions, only
ever actually produce two of them: `lookup` (`read_items`, when none of the requested IDs are
found) and `invalid-input` (malformed call arguments). `browser`, `permission`, `schema`,
`relation`, `inspection`, `staleness`, `confirmation`, and `write` describe failures reachable
only by actions that touch the filesystem, canonical-item validation, or another tab's state --
tickets 20-23's mutating tools, not these. The type is defined now because ADR 0036 fixes one
taxonomy for the whole WebMCP surface, not a per-ticket one, but only two codes are empirically
exercised by anything in this commit.

Code review (Standards + Spec axes) caught one real, fixed issue: `readTool.ts` originally used
the `'inspection'` code for malformed tool-call input, but `'inspection'` already names a
specific, different concept -- ADR 0025's "bind application to an inspected preview"
(`apply_pending_change`, ticket 23, refusing because `inspect_pending_change` was never called
first). Added a distinct `'invalid-input'` code instead, since none of ADR 0036's nine names
actually describe "the raw call arguments didn't match this tool's declared schema." It also
caught that `lookup` -- named in the ticket's own acceptance criterion -- was defined but never
actually reachable: `read_items` reported a not-found ID as `{ found: false }` inside an always-
successful envelope. Fixed so a batch where *nothing* resolves is now a genuine `lookup` failure,
while a batch that finds some but not all IDs still succeeds (a partial match against a batch of
up to five is a normal outcome, not a call failure) -- confirmed by mutation testing that this
distinction is real. Also strengthened two under-proven areas the review flagged: the real
zod-validated 0-item/6-item boundary on `read_items` (previously only exercised via the pure
function directly, bypassing the schema `createReadTool` enforces), and that a registered tool
actually reads the *current* Garden after a mid-session rescan rather than a stale closure from
registration time -- both now covered by dedicated tests, the rescan one mutation-tested against
`Workspace.tsx`'s `gardenRef` update effect.

**Not verified in a real browser:** as with ticket 17, no browser-automation tool was available
this session. Verification here is jsdom component/e2e tests only
(`coreReadToolsRegistration.test.tsx` exercises real registration and a real mid-session rescan
through the actual `Workspace` component), plus pure-function unit tests for each tool's own
logic -- not an actual `navigator.modelContext` call in a real browser.
