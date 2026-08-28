# 24: Performance fixture at 1,000 items and 5,000 relations

**What to build:** A person with a real research workload rather than a demo still gets a usable product. Indexing and search hold up against a Garden of a thousand items and five thousand relationships, collapse and focus keep the drawn Tree bounded, and a Garden larger than the target degrades honestly with a warning instead of a hard rejection or destructive behaviour.

**Blocked by:** 11, 15

**Status:** resolved

- [x] A generator produces a Garden fixture of 1,000 items and 5,000 relationships that validates against the full schema and all graph invariants
- [x] Indexing the fixture from canonical Markdown remains usable and is measured
- [x] Reopening the fixture with a warm Index Cache is measurably faster than a cold open
- [x] Search over the fixture remains usable and is measured
- [x] Branch collapse and Branch focus bound the visible SVG workload on the fixture
- [x] A Garden larger than the fixture target receives a performance warning
- [x] No hard item limit and no destructive behaviour is imposed on a larger Garden
- [x] The measurements are recorded as repeatable evidence rather than a one-off observation

## Notes

### What was built

`performanceFixture.ts` generates a Garden of exactly the ADR 0061 target
(1,000 items, 5,000 relationships by default, either scalable): every item
and relationship is genuine, schema-valid, graph-invariant-clean canonical
Markdown, built through the same `planFiles` a real Create Garden uses.
Getting to 5,000 relationships honestly means leaning heavily on Relates To
-- Parent is bounded by the item count itself, and Supports/Derived
From/Answers/Contradicts are each narrower by kind pairing (ADR 0079) than
a fully general Cross-link is; the module docstring says so rather than
pretending an even split is realistic at this scale. `performanceTarget.ts`
holds the two numbers once (`PERFORMANCE_TARGET_ITEM_COUNT`,
`PERFORMANCE_TARGET_RELATIONSHIP_COUNT`) and an `exceedsPerformanceTarget`
check, so the fixture generator and the real product warning share one
definition of "the target" rather than each hardcoding it. `Workspace.tsx`
shows a non-blocking, dismiss-free notice (`role="status"`, matching the
existing Diagnostics/rescan-notice idiom) when a real Garden exceeds it --
worded from the same constants, not a second hardcoded copy of the numbers.

### Verified

Typecheck, 1257 tests (up from 1229 after ticket 15), and a production
build all pass; the full suite was run three times with no flake.

`performanceFixture.test.ts` proves the generator itself: schema-valid and
graph-invariant-clean at small scale and at the full 1,000/5,000 target
(`index.diagnostics` empty, exact item and relationship counts), every kind
represented, and honest about its one documented edge case -- a request
below the guaranteed Supports baseline (every Claim Leaf and Harvest cites
at least one Root, ADR 0010, generated before anything else is padded) can
come back with more relationships than asked, and that is asserted rather
than hidden.

`performanceMeasurement.test.ts` measures, against a real Garden built
through the real `openGarden` (not a shortcut): indexing correctness and a
generous 10-second usability ceiling; that a warm reopen is at least twice
as fast as a cold one (not merely faster -- see below); that the warm
reopen's Garden Revision matches the cold one's exactly (ADR 0062); search
correctness and a 500ms ceiling, both for one query and for twenty in a
row; that collapsing every top-level Branch or focusing on one bounds not
only `visibleTreeRows`' row count but the actual `nodes`/`links`/
`crossLinks` `computeTreeLayout` produces -- what `GardenTree.tsx` turns
into SVG elements one for one; and that a Garden 20% over target (1,200
items, 6,000 relationships) opens completely, with every item present and
`diagnostics` empty, while `exceedsPerformanceTarget` correctly reports it.

One real run's figures, since "measured" should mean something concrete
and not just a passing assertion: cold open 169.4ms, warm open 38.8ms (a
real ~4.4x margin this run; repeated runs during development ranged
roughly 4x-7x), search over 1,000 items 0.17ms. These numbers are not
committed as a frozen artifact -- the suite re-measures and re-verifies
them, directionally, every time it runs, which is what makes this
repeatable evidence rather than a note that goes stale the moment the code
changes under it.

`performanceWarning.test.tsx` proves the UI: no warning under the target,
a warning (with every item still present, none dropped) at 1,001 items,
and that the notice is `role="status"` rather than `role="alert"` -- stated
as information, not a failure, since nothing is actually wrong.

### What the review caught, and what changed

Both review axes (Standards and Spec, both Opus) ran, and the Spec
reviewer found a real, serious problem with my own verification: the
original warm-faster-than-cold assertion (`warmMs < coldMs`) is not a real
regression guard. I confirmed this myself by disconnecting the Index Cache
entirely and running the test five times -- it still passed most of the
time, on JIT warmup alone. Tightened to `warmMs < coldMs / 2`, comfortably
under the real ~4x-7x margin the cache actually produces and comfortably
over what warmup alone produces; re-ran the same disconnection five times
against the tightened assertion and it failed every time.

The Spec review also found the "bounds the visible SVG workload" claim was
under-proven: the only thing measured was `visibleTreeRows`' row count, a
proxy for what gets drawn rather than the drawn output itself, and
`treeLayout.ts` iterates every one of the Garden's relationships on every
layout regardless of what is collapsed -- the original test measured
neither the real SVG output nor that cost. Added a test against
`computeTreeLayout` directly, asserting `nodes`/`links`/`crossLinks` -- what
actually becomes one SVG element each -- are bounded, not just the row
count. Two full layout computations over 5,000 relationships together cost
about 10ms in that test, confirming the iteration is cheap in absolute
terms at this target even though it is not itself bounded by collapse or
focus.

The search timing test also did not check that the query it was timing
returned anything, so a search silently returning nothing would have
passed as "fast." Fixed to assert both together.

The review also found: `pickEdges` had taken a `symmetric` boolean at five
call sites when `relations.ts` already owns `isSymmetricRelation(type)` --
a mismatched literal at any one of those five sites would have silently
started emitting duplicate Cross-links, so this now reads the fact from
its one real source instead of repeating it. A duplicated JSDoc comment on
`pickEdges` (only the second block was actually attached) was merged into
one. `Workspace.tsx`'s warning banner had re-hardcoded "1,000 items, 5,000
relationships" as prose, which is exactly the drift `performanceTarget.ts`
exists to prevent -- now formatted from the shared constants. The fixture
generator's own `PERFORMANCE_FIXTURE_ITEM_COUNT`/
`PERFORMANCE_FIXTURE_RELATIONSHIP_COUNT` were pure aliases for
`performanceTarget.ts`'s constants; removed, and every reference now
imports the one real source directly. Three separate `beforeAll` blocks in
the measurement suite were independently rebuilding the same 1,000-item
Garden; consolidated into one shared build for search and Tree-bounding,
since neither test mutates it (cold/warm timing keeps its own dedicated
fixture, since sharing setup work with it would contaminate the very thing
being timed).

The Standards review also flagged that `CONTEXT.md` lists "fixture" as a
term to avoid for Sample Garden specifically. This generated Garden is not
the Sample Garden -- it never becomes a person's files, exists only inside
a test run, and is roughly a thousand times larger by design -- so the
name itself was kept (it is the ticket's own title, and standard testing
vocabulary), but the module docstring now says explicitly what this is not,
so the distinction is not left for a reader to infer.

### What was deliberately left as-is

The review flagged a handful of small duplications as judgement calls
(`fixtureEntropy()` repeated in two test files; near-identical fixture
helpers in `performanceFixture.test.ts` and `performanceMeasurement.test.ts`)
consistent with this repo's established preference for self-contained test
files over shared test-only abstractions -- left alone.

`treeLayout.ts` itself was not changed to skip relationships for a
collapsed subtree. At the 5,000-relationship target this costs roughly
5ms per layout, measured directly rather than assumed; optimizing it now
would be solving a problem the measurement does not show exists. If the
target ever grows meaningfully past this ticket's scope, that iteration is
the first place to look.
